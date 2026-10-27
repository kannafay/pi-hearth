use super::{storage, types::*};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
};

#[cfg(test)]
mod tests;

pub(super) fn relocate(value: &str, paths: &[PathRelocation]) -> String {
    paths
        .iter()
        .map(|change| {
            crate::app_data::relocate_path(value, Path::new(&change.from), Path::new(&change.to))
        })
        .find(|updated| updated != value)
        .unwrap_or_else(|| value.to_owned())
}

struct DirectoryMove {
    from: PathBuf,
    to: PathBuf,
    // A cross-volume copy retains its source until the database commits.
    backup: Option<PathBuf>,
    published: bool,
}

struct FileChange {
    file: PathBuf,
    backup: PathBuf,
}

pub(super) struct Migration {
    data: PathBuf,
    catalog: WorkspaceCatalog,
    patch: AppSettingsPatch,
    paths: Vec<PathRelocation>,
    directories: Vec<DirectoryMove>,
    files: Vec<FileChange>,
    committed: bool,
}

impl Migration {
    pub fn prepare(
        data: PathBuf,
        default: PathBuf,
        directory: String,
        settings: AppSettings,
        catalog: WorkspaceCatalog,
    ) -> Result<Self, String> {
        let source = if settings.projects_directory.is_empty() {
            default.clone()
        } else {
            PathBuf::from(&settings.projects_directory)
        };
        let target = if directory.is_empty() {
            default
        } else {
            PathBuf::from(&directory)
        };
        if !source.is_absolute() || !target.is_absolute() {
            return Err("项目保存目录必须是绝对路径。".into());
        }
        fs::create_dir_all(&target).map_err(|e| format!("无法创建项目保存目录：{e}"))?;
        let target = dunce::canonicalize(target).map_err(|e| e.to_string())?;
        let source = match dunce::canonicalize(&source) {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => source,
            Err(error) => return Err(format!("无法访问原项目目录：{error}")),
        };
        let same = super::catalog::same_path(&source.to_string_lossy(), &target.to_string_lossy());
        if !same && (target.starts_with(&source) || source.starts_with(&target)) {
            return Err("新旧项目保存目录不能互相包含，请选择其他目录。".into());
        }
        let saved = if directory.is_empty() {
            String::new()
        } else {
            target.to_string_lossy().into_owned()
        };
        let patch = AppSettingsPatch {
            projects_directory: Some(saved.clone()),
            custom_projects_directory: if saved.is_empty() { None } else { Some(saved) },
            ..Default::default()
        };
        let mut candidates = Vec::new();
        if !same {
            for project in &catalog.projects {
                let from = match dunce::canonicalize(&project.path) {
                    Ok(path) => path,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(format!("无法访问项目 {}：{error}", project.name)),
                };
                if from == source {
                    return Err("原保存目录本身被用作项目，无法将它迁入其他保存目录。".into());
                }
                if from.starts_with(&source) {
                    if data.starts_with(&from) {
                        return Err("项目目录包含应用数据目录，无法迁移。".into());
                    }
                    candidates.push(from);
                }
            }
        }
        candidates.sort_by_key(|path| path.components().count());
        let mut directories: Vec<DirectoryMove> = Vec::new();
        for from in candidates {
            if directories
                .iter()
                .any(|parent| from.starts_with(&parent.from))
            {
                continue;
            }
            let to = target.join(from.strip_prefix(&source).unwrap());
            if fs::symlink_metadata(&to).is_ok() {
                return Err(format!("目标目录已存在，未迁移任何项目：{}", to.display()));
            }
            directories.push(DirectoryMove {
                from,
                to,
                backup: None,
                published: false,
            });
        }
        let mut paths: Vec<_> = directories
            .iter()
            .map(|item| PathRelocation {
                from: item.from.to_string_lossy().into_owned(),
                to: item.to.to_string_lossy().into_owned(),
            })
            .collect();
        // Preserve references saved through an alternate spelling or directory alias.
        for project in &catalog.projects {
            if let Ok(real) = dunce::canonicalize(&project.path) {
                let updated = relocate(&real.to_string_lossy(), &paths);
                if updated != real.to_string_lossy()
                    && relocate(&project.path, &paths) == project.path
                {
                    paths.push(PathRelocation {
                        from: project.path.clone(),
                        to: updated,
                    });
                }
            }
        }
        Ok(Self {
            data,
            catalog,
            patch,
            paths,
            directories,
            files: Vec::new(),
            committed: false,
        })
    }

    pub fn run(mut self) -> Result<ProjectLocationChange, String> {
        let result = self.perform();
        match result {
            Ok((settings, preferences)) => {
                self.committed = true;
                let mut warnings = Vec::new();
                for change in &self.files {
                    if let Err(error) = remove_entry(&change.backup) {
                        warnings.push(format!(
                            "迁移已完成，旧记录备份未能清理 {}：{error}",
                            change.backup.display()
                        ));
                    }
                }
                for change in &self.directories {
                    if let Some(backup) = &change.backup {
                        if let Err(error) = remove_directory(backup) {
                            warnings.push(format!(
                                "迁移已完成，原项目备份未能清理 {}：{error}",
                                backup.display()
                            ));
                        }
                    }
                }
                for project in &mut self.catalog.projects {
                    project.path = relocate(&project.path, &self.paths);
                }
                for session in &mut self.catalog.sessions {
                    session.path = relocate(&session.path, &self.paths);
                    session.cwd = relocate(&session.cwd, &self.paths);
                }
                self.catalog.selection = preferences.selection;
                self.catalog.session_preferences = preferences.session_preferences;
                Ok(ProjectLocationChange {
                    settings,
                    catalog: self.catalog.clone(),
                    paths: self.paths.clone(),
                    warnings,
                })
            }
            Err(error) => {
                let errors = self.rollback();
                Err(if errors.is_empty() {
                    format!("项目迁移失败，已恢复原目录和设置：{error}")
                } else {
                    format!(
                        "项目迁移失败：{error}；部分文件需要手动恢复：{}",
                        errors.join("；")
                    )
                })
            }
        }
    }

    fn perform(&mut self) -> Result<(AppSettings, storage::Preferences), String> {
        for change in &mut self.directories {
            fs::create_dir_all(change.to.parent().unwrap()).map_err(|e| e.to_string())?;
            // Recheck after preflight; never merge with an existing destination.
            if fs::symlink_metadata(&change.to).is_ok() {
                return Err(format!("目标目录已存在：{}", change.to.display()));
            }
            match fs::rename(&change.from, &change.to) {
                Ok(()) => change.published = true,
                Err(error)
                    if error.kind() == std::io::ErrorKind::CrossesDevices
                        || (cfg!(windows) && error.raw_os_error() == Some(17)) =>
                {
                    let backup = temporary(&change.from);
                    fs::rename(&change.from, &backup)
                        .map_err(|e| format!("无法移动项目 {}：{e}", change.from.display()))?;
                    change.backup = Some(backup.clone());
                    // Own the target before copying, allowing safe rollback of partial copies.
                    fs::create_dir(&change.to).map_err(|e| e.to_string())?;
                    change.published = true;
                    copy_directory(&backup, &change.from, &change.to, &self.paths)?;
                }
                Err(error) => {
                    return Err(format!("无法移动项目 {}：{error}", change.from.display()));
                }
            }
        }
        if self.paths.is_empty() {
            return storage::save_project_location(&self.data, self.patch.clone(), &self.paths);
        }
        let mut links = Vec::new();
        for change in &self.directories {
            collect_links(&change.to, &mut links)?;
        }
        for (file, target, directory) in links {
            // Relative links continue to work after moving the whole project.
            if !target.is_absolute() {
                continue;
            }
            let updated = relocate(&dunce::simplified(&target).to_string_lossy(), &self.paths);
            if super::catalog::same_path(&updated, &dunce::simplified(&target).to_string_lossy()) {
                continue;
            }
            let backup = temporary(&file);
            fs::rename(&file, &backup).map_err(|e| e.to_string())?;
            self.files.push(FileChange {
                file: file.clone(),
                backup,
            });
            create_link(Path::new(&updated), &file, directory)?;
        }
        let sessions: Vec<_> = self
            .catalog
            .sessions
            .iter()
            .map(|session| session.path.clone())
            .collect();
        for path in sessions {
            let file = PathBuf::from(relocate(&path, &self.paths));
            let input = match File::open(&file) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(format!("无法读取会话 {}：{error}", file.display())),
            };
            let mut input = BufReader::new(input);
            let mut first = Vec::new();
            input
                .read_until(b'\n', &mut first)
                .map_err(|e| e.to_string())?;
            let mut header: serde_json::Value = serde_json::from_slice(&first)
                .map_err(|e| format!("会话记录格式有误 {}：{e}", file.display()))?;
            let original = header.clone();
            for field in ["cwd", "parentSession"] {
                if let Some(path) = header[field].as_str() {
                    header[field] = relocate(path, &self.paths).into();
                }
            }
            if header != original {
                let mut first_updated = serde_json::to_vec(&header).map_err(|e| e.to_string())?;
                if first.ends_with(b"\r\n") {
                    first_updated.extend_from_slice(b"\r\n");
                } else if first.ends_with(b"\n") {
                    first_updated.push(b'\n');
                }
                self.replace(&file, |output| {
                    output.write_all(&first_updated)?;
                    std::io::copy(&mut input, output)?;
                    Ok(())
                })?;
            }
        }
        let projects: Vec<_> = self
            .catalog
            .projects
            .iter()
            .map(|project| project.path.clone())
            .collect();
        for project in projects {
            if relocate(&project, &self.paths) == project {
                continue;
            }
            let file = Path::new(&relocate(&project, &self.paths)).join(".pi/settings.json");
            self.rewrite_json(&file, |value, paths| {
                if let Some(path) = value["sessionDir"].as_str() {
                    value["sessionDir"] = relocate(path, paths).into();
                }
            })?;
        }
        self.rewrite_json(&self.data.join("resources.json"), |value, paths| {
            if let Some(values) = value.as_object_mut() {
                *values = std::mem::take(values)
                    .into_iter()
                    .map(|(key, value)| {
                        let updated = match serde_json::from_str::<(String, String, String)>(&key) {
                            Ok((kind, source, name)) => {
                                serde_json::to_string(&(kind, relocate(&source, paths), name))
                                    .unwrap()
                            }
                            Err(_) => key,
                        };
                        (updated, value)
                    })
                    .collect();
            }
        })?;
        storage::save_project_location(&self.data, self.patch.clone(), &self.paths)
    }

    fn rewrite_json(
        &mut self,
        file: &Path,
        update: impl FnOnce(&mut serde_json::Value, &[PathRelocation]),
    ) -> Result<(), String> {
        let bytes = match fs::read(file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(format!("无法读取 {}：{error}", file.display())),
        };
        let mut value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|e| format!("配置格式有误 {}：{e}", file.display()))?;
        let original = value.clone();
        update(&mut value, &self.paths);
        if value != original {
            self.replace(file, |output| {
                serde_json::to_writer_pretty(output, &value).map_err(std::io::Error::other)
            })?;
        }
        Ok(())
    }

    fn replace(
        &mut self,
        file: &Path,
        write: impl FnOnce(&mut File) -> std::io::Result<()>,
    ) -> Result<(), String> {
        let pending = temporary(file);
        let backup = temporary(file);
        let result = (|| {
            let metadata = fs::metadata(file)?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&pending)?;
            write(&mut output)?;
            output.set_times(fs::FileTimes::new().set_modified(metadata.modified()?))?;
            output.sync_all()?;
            drop(output);
            fs::set_permissions(&pending, metadata.permissions())?;
            fs::rename(file, &backup)?;
            self.files.push(FileChange {
                file: file.to_owned(),
                backup,
            });
            fs::rename(&pending, file)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&pending);
        }
        result.map_err(|e| format!("无法更新路径记录 {}：{e}", file.display()))
    }

    fn rollback(&mut self) -> Vec<String> {
        let mut errors = Vec::new();
        for change in self.files.drain(..).rev() {
            let result = if fs::symlink_metadata(&change.file).is_ok() {
                remove_entry(&change.file)
            } else {
                Ok(())
            }
            .and_then(|_| fs::rename(&change.backup, &change.file));
            if let Err(error) = result {
                errors.push(format!(
                    "{} → {}：{error}",
                    change.backup.display(),
                    change.file.display()
                ));
            }
        }
        for change in self.directories.iter_mut().rev() {
            let restore_from = change.backup.as_deref().unwrap_or(&change.to).to_owned();
            let result = if let Some(backup) = &change.backup {
                if change.published {
                    // This tree was created exclusively by this migration.
                    if let Err(error) = remove_directory(&change.to) {
                        errors.push(format!("{}：{error}", change.to.display()));
                    }
                }
                fs::rename(backup, &change.from)
            } else if change.published {
                fs::rename(&change.to, &change.from)
            } else {
                Ok(())
            };
            if let Err(error) = result {
                errors.push(format!(
                    "{} → {}：{error}",
                    restore_from.display(),
                    change.from.display()
                ));
            }
            change.published = false;
            change.backup = None;
        }
        errors
    }
}

impl Drop for Migration {
    fn drop(&mut self) {
        if !self.committed {
            let _ = self.rollback();
        }
    }
}

fn temporary(file: &Path) -> PathBuf {
    file.with_file_name(format!(".pi-hearth-migration-{}", uuid::Uuid::new_v4()))
}

fn is_link(metadata: &fs::Metadata) -> bool {
    metadata.is_symlink()
}

fn is_directory(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // symlink_metadata().is_dir() is false for Windows junctions.
        metadata.file_attributes() & 0x10 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.is_dir()
    }
}

fn remove_entry(path: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if is_directory(&metadata) {
        return fs::remove_dir(path);
    }
    #[cfg(windows)]
    if metadata.permissions().readonly() && !is_link(&metadata) {
        let mut permissions = metadata.permissions();
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions)?;
    }
    fs::remove_file(path)
}

// Only called for a uniquely named source backup or a target created by this
// migration. Never traverse links when removing a copied tree.
fn remove_directory(path: &Path) -> std::io::Result<()> {
    if is_link(&fs::symlink_metadata(path)?) {
        return remove_entry(path);
    }
    for entry in fs::read_dir(path)? {
        let file = entry?.path();
        let metadata = fs::symlink_metadata(&file)?;
        if is_directory(&metadata) && !is_link(&metadata) {
            remove_directory(&file)?;
        } else {
            remove_entry(&file)?;
        }
    }
    fs::remove_dir(path)
}

fn collect_links(path: &Path, links: &mut Vec<(PathBuf, PathBuf, bool)>) -> Result<(), String> {
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let file = entry.map_err(|e| e.to_string())?.path();
        let metadata = fs::symlink_metadata(&file).map_err(|e| e.to_string())?;
        if is_link(&metadata) {
            links.push((
                file.clone(),
                fs::read_link(&file).map_err(|e| e.to_string())?,
                is_directory(&metadata),
            ));
        } else if metadata.is_dir() {
            collect_links(&file, links)?;
        }
    }
    Ok(())
}

fn create_link(target: &Path, alias: &Path, directory: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        if directory {
            return crate::app_data::directory_alias(target, alias);
        }
        std::os::windows::fs::symlink_file(target, alias).map_err(|e| e.to_string())
    }
    #[cfg(unix)]
    {
        let _ = directory;
        std::os::unix::fs::symlink(target, alias).map_err(|e| e.to_string())
    }
}

fn copy_directory(
    source: &Path,
    original: &Path,
    target: &Path,
    paths: &[PathRelocation],
) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        let metadata = fs::symlink_metadata(&from).map_err(|e| e.to_string())?;
        if is_link(&metadata) {
            let link = fs::read_link(&from).map_err(|e| e.to_string())?;
            let linked_target = if link.is_absolute() {
                PathBuf::from(relocate(&dunce::simplified(&link).to_string_lossy(), paths))
            } else {
                original.join(&link)
            };
            if is_directory(&metadata) {
                let linked_target =
                    PathBuf::from(relocate(&linked_target.to_string_lossy(), paths));
                create_link(&linked_target, &to, true)?;
            } else {
                let linked_target = if link.is_absolute() {
                    linked_target
                } else {
                    link
                };
                create_link(&linked_target, &to, false)?;
            }
        } else if metadata.is_dir() {
            fs::create_dir(&to).map_err(|e| e.to_string())?;
            copy_directory(&from, &original.join(entry.file_name()), &to, paths)?;
        } else if metadata.is_file() {
            fs::copy(&from, &to).map_err(|e| format!("无法复制 {}：{e}", from.display()))?;
            #[cfg(windows)]
            let file = {
                use std::os::windows::fs::OpenOptionsExt;
                File::options().access_mode(0x100).open(&to) // FILE_WRITE_ATTRIBUTES, including read-only Git objects.
            };
            #[cfg(not(windows))]
            let file = File::open(&to);
            file.and_then(|file| {
                file.set_times(fs::FileTimes::new().set_modified(metadata.modified()?))
            })
            .map_err(|e| e.to_string())?;
        } else {
            return Err(format!("项目中存在无法迁移的文件：{}", from.display()));
        }
    }
    Ok(())
}
