use std::path::{Path, PathBuf};
use tauri::Manager;

const DIRECTORY: &str = "Pi Hearth";

struct DataDirectory(PathBuf);

pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.try_state::<DataDirectory>()
        .map(|state| state.0.clone())
        .ok_or("应用数据目录尚未准备完成。".into())
}

// Initialize before opening the database. Keep the identifier and WebView profile
// stable, preserving frontend preferences and drafts.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("app-data")
        .setup(|app, _| {
            let legacy = app.path().app_local_data_dir()?;
            let data = app.path().local_data_dir()?.join(DIRECTORY);
            migrate(&legacy, &data).map_err(std::io::Error::other)?;
            app.manage(DataDirectory(dunce::canonicalize(data)?));
            Ok(())
        })
        .build()
}

fn migrate(legacy: &Path, data: &Path) -> Result<(), String> {
    if !legacy.is_absolute()
        || !data.is_absolute()
        || legacy.parent().is_none()
        || legacy.parent() != data.parent()
        || legacy == data
        || (legacy.exists() && !legacy.is_dir())
    {
        return Err("应用数据迁移目录无效。".into());
    }
    if data.join(".data-directory-v1").is_file() {
        return Ok(());
    }
    if data.exists() {
        return Err("新应用数据目录已存在，已保留原数据，请先检查目录。".into());
    }
    let parent = data.parent().unwrap();
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(".Pi Hearth-migration-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&temporary).map_err(|e| e.to_string())?;
    let mut published = false;
    let result = (|| {
        let destination = dunce::canonicalize(&temporary)
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("应用数据目录无效。")?
            .join(DIRECTORY);
        let mut origins = vec![legacy.to_owned()];
        let mut links = Vec::new();
        // Copy the merged AppData view; packaged environments may redirect only
        // some files, so renaming the directory can leave part of the data behind.
        for name in [
            "sessions",
            "workspace",
            "attachments",
            "logs",
            "tool-output",
        ] {
            let source = legacy.join(name);
            if source.exists() {
                if let Ok(real) = dunce::canonicalize(&source)
                    && let Some(root) = real.parent()
                    && root.file_name() == legacy.file_name()
                {
                    origins.push(root.to_owned());
                }
                if is_link(&std::fs::symlink_metadata(&source).map_err(|e| e.to_string())?) {
                    links.push((
                        temporary.join(name),
                        dunce::canonicalize(&source).map_err(|e| e.to_string())?,
                    ));
                } else {
                    copy_directory(&source, &temporary.join(name), &mut links)?;
                }
            }
        }
        for name in ["resources.json", "workspace.json"] {
            if legacy.join(name).exists() {
                std::fs::copy(legacy.join(name), temporary.join(name))
                    .map_err(|e| e.to_string())?;
            }
        }
        if legacy.join("app.db").exists() {
            let source = rusqlite::Connection::open_with_flags(
                legacy.join("app.db"),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .map_err(|e| e.to_string())?;
            source
                .backup("main", temporary.join("app.db"), None)
                .map_err(|e| e.to_string())?;
            if let Ok(real) = dunce::canonicalize(legacy.join("app.db"))
                && let Some(root) = real.parent()
                && root.file_name() == legacy.file_name()
            {
                origins.push(root.to_owned());
            }
        }
        origins.sort();
        origins.dedup();
        for origin in &origins {
            crate::pi::storage::relocate_data_paths(&temporary, origin, &destination)?;
            relocate_resource_preferences(&temporary, origin, &destination)?;
        }
        relocate_sessions(&temporary.join("sessions"), &origins, &destination)?;
        std::fs::rename(&temporary, data).map_err(|e| format!("无法完成目录迁移：{e}"))?;
        published = true;
        // Create links after publication: Windows can reject renaming a tree
        // containing freshly created junctions. No commands run until setup ends.
        for (alias, target) in links {
            let relative = alias.strip_prefix(&temporary).map_err(|e| e.to_string())?;
            directory_alias(&target, &data.join(relative))?;
        }
        std::fs::write(data.join(".data-directory-v1"), b"1").map_err(|e| e.to_string())
    })();
    if result.is_err() {
        // Delete only this attempt's verified staging directory, never the source.
        let owned = if published { data } else { &temporary };
        if let (Ok(real), Ok(base)) = (dunce::canonicalize(owned), dunce::canonicalize(parent))
            && real.starts_with(&base)
            && real.file_name() == owned.file_name()
        {
            let _ = std::fs::remove_dir_all(&real);
        }
    }
    result.map_err(|error| format!("无法迁移应用数据，原目录已保留：{error}"))
}

fn copy_directory(
    source: &Path,
    destination: &Path,
    links: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<(), String> {
    std::fs::create_dir(destination)
        .map_err(|e| format!("无法创建 {}：{e}", destination.display()))?;
    for entry in
        std::fs::read_dir(source).map_err(|e| format!("无法读取 {}：{e}", source.display()))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = destination.join(entry.file_name());
        let metadata = entry
            .metadata()
            .map_err(|e| format!("无法读取文件信息 {}：{e}", entry.path().display()))?;
        let kind = metadata.file_type();
        if is_link(&metadata) && entry.path().is_dir() {
            links.push((
                target,
                dunce::canonicalize(entry.path()).map_err(|e| e.to_string())?,
            ));
        } else if kind.is_dir() {
            copy_directory(&entry.path(), &target, links)?;
        } else {
            std::fs::copy(entry.path(), target)
                .map_err(|e| format!("无法复制 {}：{e}", entry.path().display()))?;
        }
    }
    Ok(())
}

fn is_link(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT includes junctions.
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn directory_alias(target: &Path, alias: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Junctions work without administrator rights. Node is also Pi's runtime;
        // pass paths as arguments rather than interpolating them into a shell.
        let result = std::process::Command::new("node")
            .arg("-e")
            .arg("require('node:fs').symlinkSync(process.argv[1], process.argv[2], 'junction')")
            .arg(target)
            .arg(alias)
            .creation_flags(0x08000000)
            .output()
            .map_err(|_| "无法保留工作目录链接，请确认 Node.js 已安装。")?;
        if !result.status.success() {
            eprintln!(
                "保留工作目录链接失败：{}",
                String::from_utf8_lossy(&result.stderr)
            );
            return Err("无法保留工作目录中的链接，原数据未删除。".into());
        }
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, alias)
        .map_err(|error| format!("无法保留工作目录链接：{error}"))?;
    Ok(())
}

pub(crate) fn relocate_path(value: &str, legacy: &Path, data: &Path) -> String {
    let old = legacy.to_string_lossy();
    let normalize = |path: &str| {
        if cfg!(windows) {
            path.replace('\\', "/").to_ascii_lowercase()
        } else {
            path.to_owned()
        }
    };
    let normalized = normalize(value);
    let prefix = normalize(&old);
    if normalized == prefix {
        data.to_string_lossy().into_owned()
    } else if normalized.starts_with(&format!("{prefix}/")) {
        let suffix = &value[old.len() + 1..];
        data.join(suffix).to_string_lossy().into_owned()
    } else {
        value.to_owned()
    }
}

fn relocate_sessions(
    directory: &Path,
    origins: &[PathBuf],
    destination: &Path,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
        let file = entry.map_err(|e| e.to_string())?.path();
        if file
            .extension()
            .is_none_or(|extension| extension != "jsonl")
            || !file.is_file()
        {
            continue;
        }
        let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
        let end = bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .unwrap_or(bytes.len());
        let Ok(mut header) = serde_json::from_slice::<serde_json::Value>(&bytes[..end]) else {
            continue;
        };
        if header["type"] != "session" {
            continue;
        }
        let original = header.clone();
        for field in ["cwd", "parentSession"] {
            if let Some(path) = header[field].as_str() {
                let mut path = path.to_owned();
                for origin in origins {
                    path = relocate_path(&path, origin, destination);
                }
                header[field] = path.into();
            }
        }
        if header != original {
            let mut updated = serde_json::to_vec(&header).map_err(|e| e.to_string())?;
            updated.extend_from_slice(&bytes[end..]);
            std::fs::write(file, updated).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn relocate_resource_preferences(
    data: &Path,
    legacy: &Path,
    destination: &Path,
) -> Result<(), String> {
    let file = data.join("resources.json");
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let preferences: std::collections::HashMap<String, bool> =
        serde_json::from_slice(&bytes).map_err(|_| "资源启停设置格式有误，原文件已保留。")?;
    let preferences: std::collections::HashMap<_, _> = preferences
        .into_iter()
        .map(|(key, enabled)| {
            let key = match serde_json::from_str::<(String, String, String)>(&key) {
                Ok((kind, source, name)) => serde_json::to_string(&(
                    kind,
                    relocate_path(&source, legacy, destination),
                    name,
                ))
                .unwrap(),
                Err(_) => key,
            };
            (key, enabled)
        })
        .collect();
    let temporary = data.join("resources-migration.tmp");
    std::fs::write(&temporary, serde_json::to_vec(&preferences).unwrap())
        .map_err(|e| e.to_string())?;
    std::fs::rename(temporary, file).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    const LEGACY_DIRECTORY: &str = "io.github.kannafay.pi-hearth";

    fn fixture() -> PathBuf {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/data-directory-test")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        dunce::canonicalize(root).unwrap()
    }

    #[test]
    fn migration_preserves_files_and_history_content_and_is_repeatable() {
        let root = fixture();
        let legacy = root.join(LEGACY_DIRECTORY);
        let data = root.join(DIRECTORY);
        std::fs::create_dir_all(legacy.join("workspace")).unwrap();
        std::fs::create_dir_all(legacy.join("sessions")).unwrap();
        std::fs::write(legacy.join("workspace/keep.txt"), "original").unwrap();
        let history = format!(
            "{}\n{{\"type\":\"message\",\"text\":\"保留正文和旧路径引用\"}}\n",
            serde_json::json!({"type":"session", "cwd":legacy.join("workspace")})
        );
        std::fs::write(legacy.join("sessions/history.jsonl"), &history).unwrap();
        let resource_key = serde_json::to_string(&(
            "skills",
            legacy.join("workspace/.pi/skills/demo/SKILL.md"),
            "demo",
        ))
        .unwrap();
        std::fs::write(
            legacy.join("resources.json"),
            serde_json::to_vec(&serde_json::json!({resource_key:false})).unwrap(),
        )
        .unwrap();
        std::fs::write(legacy.join("workspace.json"), serde_json::to_vec(&serde_json::json!({
            "selection": {"projectPath":null, "sessionPath":legacy.join("sessions/history.jsonl")},
            "sessionPreferences": {legacy.join("sessions/history.jsonl").to_string_lossy().to_string(): {"pinned":true}}
        })).unwrap()).unwrap();

        migrate(&legacy, &data).unwrap();
        assert_eq!(
            std::fs::read_to_string(data.join("workspace/keep.txt")).unwrap(),
            "original"
        );
        assert_eq!(
            std::fs::read_to_string(legacy.join("sessions/history.jsonl")).unwrap(),
            history
        );
        let updated = std::fs::read_to_string(data.join("sessions/history.jsonl")).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(updated.lines().next().unwrap()).unwrap()["cwd"],
            data.join("workspace").to_string_lossy().as_ref()
        );
        assert_eq!(
            updated.split_once('\n').unwrap().1,
            history.split_once('\n').unwrap().1
        );
        let connection = rusqlite::Connection::open(data.join("app.db")).unwrap();
        let selected: String = connection
            .query_row("SELECT session_path FROM workspace_selection", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            selected,
            data.join("sessions/history.jsonl").to_string_lossy()
        );
        let (path, pinned): (String, bool) = connection
            .query_row("SELECT path, pinned FROM session_preferences", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(path, crate::pi::catalog::session_key(&selected));
        assert!(pinned);
        let resources: std::collections::HashMap<String, bool> =
            serde_json::from_slice(&std::fs::read(data.join("resources.json")).unwrap()).unwrap();
        let resource_key = serde_json::to_string(&(
            "skills",
            data.join("workspace/.pi/skills/demo/SKILL.md"),
            "demo",
        ))
        .unwrap();
        assert_eq!(resources.get(&resource_key), Some(&false));
        std::fs::write(data.join("workspace/keep.txt"), "latest").unwrap();
        // Subsequent starts do not rebuild the database/search cache again.
        connection
            .execute(
                "INSERT INTO search_documents VALUES ('cached', 0, 0, 1, '[]')",
                [],
            )
            .unwrap();
        migrate(&legacy, &data).unwrap();
        let cached: i64 = connection
            .query_row("SELECT COUNT(*) FROM search_documents", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(cached, 1);
        assert_eq!(
            std::fs::read_to_string(legacy.join("workspace/keep.txt")).unwrap(),
            "original"
        );
        assert_eq!(
            std::fs::read_to_string(data.join("sessions/history.jsonl")).unwrap(),
            updated
        );
    }

    #[test]
    fn first_install_uses_the_app_name_without_creating_a_legacy_directory() {
        let root = fixture();
        let legacy = root.join(LEGACY_DIRECTORY);
        let data = root.join(DIRECTORY);
        migrate(&legacy, &data).unwrap();
        assert!(data.is_dir());
        assert!(data.join(".data-directory-v1").is_file());
        assert!(!legacy.exists());
    }

    #[test]
    fn existing_destinations_and_unrelated_directories_are_never_overwritten() {
        let root = fixture();
        let legacy = root.join(LEGACY_DIRECTORY);
        let data = root.join(DIRECTORY);
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(legacy.join("keep.txt"), "old").unwrap();
        std::fs::write(data.join("keep.txt"), "new").unwrap();
        assert!(migrate(&legacy, &data).is_err());
        assert_eq!(
            std::fs::read_to_string(legacy.join("keep.txt")).unwrap(),
            "old"
        );
        assert_eq!(
            std::fs::read_to_string(data.join("keep.txt")).unwrap(),
            "new"
        );
        assert!(migrate(&legacy, &root.join("nested/destination")).is_err());
        let neighbor = format!("{}-other/workspace", legacy.display());
        assert_eq!(relocate_path(&neighbor, &legacy, &data), neighbor);
    }

    #[test]
    fn database_snapshot_includes_committed_wal_changes() {
        let root = fixture();
        let legacy = root.join(LEGACY_DIRECTORY);
        let data = root.join(DIRECTORY);
        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("workspace.json"), "{}").unwrap();
        crate::pi::storage::relocate_data_paths(&legacy, &legacy, &legacy).unwrap();
        let source = rusqlite::Connection::open(legacy.join("app.db")).unwrap();
        source.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        source
            .execute(
                "UPDATE app_settings SET value='\"dark\"' WHERE key='theme'",
                [],
            )
            .unwrap();
        assert!(legacy.join("app.db-wal").exists());
        migrate(&legacy, &data).unwrap();
        let target = rusqlite::Connection::open(data.join("app.db")).unwrap();
        let value: String = target
            .query_row(
                "SELECT value FROM app_settings WHERE key='theme'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "\"dark\"");
    }

    #[test]
    fn workspace_directory_links_are_preserved_without_copying_external_trees() {
        let root = fixture();
        let legacy = root.join(LEGACY_DIRECTORY);
        let data = root.join(DIRECTORY);
        let external = root.join("external");
        std::fs::create_dir_all(legacy.join("workspace")).unwrap();
        std::fs::create_dir(&external).unwrap();
        std::fs::write(external.join("keep.txt"), "outside").unwrap();
        directory_alias(&external, &legacy.join("workspace/linked")).unwrap();
        migrate(&legacy, &data).unwrap();
        let copied = data.join("workspace/linked");
        assert!(
            std::fs::symlink_metadata(&copied)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(dunce::canonicalize(copied).unwrap(), external);
        assert_eq!(
            std::fs::read_to_string(external.join("keep.txt")).unwrap(),
            "outside"
        );
    }
}
