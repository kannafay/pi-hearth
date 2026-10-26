use super::{client::PiManager, types::ComposerCommand};
use ignore::WalkBuilder;
use serde_json::{Value, json};
use std::{
    path::Path,
    time::{Duration, Instant},
};
use tauri::State;

fn skill_commands(value: &Value) -> Vec<ComposerCommand> {
    let mut commands: Vec<_> = value["commands"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|command| command["source"] == "skill")
        .filter_map(|command| {
            let name = command["name"].as_str()?;
            if !name.starts_with("skill:") || name.chars().any(char::is_whitespace) {
                return None;
            }
            Some(ComposerCommand {
                name: name.into(),
                description: command["description"].as_str().unwrap_or_default().into(),
            })
        })
        .collect();
    commands.sort_by(|a, b| a.name.cmp(&b.name));
    commands.dedup_by(|a, b| a.name == b.name);
    commands
}

#[tauri::command]
pub async fn pi_composer_commands(
    manager: State<'_, PiManager>,
    instance_id: String,
) -> Result<Vec<ComposerCommand>, String> {
    let client = manager.client(&instance_id).await?;
    let value = client.request(json!({"type":"get_commands"}), None).await?;
    Ok(skill_commands(&value))
}

fn score(path: &str, query: &str) -> Option<u8> {
    let path = path.to_lowercase();
    let file = path.rsplit('/').next().unwrap_or(&path);
    if query.is_empty() || file.starts_with(query) {
        return Some(0);
    }
    if file.contains(query) {
        return Some(1);
    }
    if path.contains(query) {
        return Some(2);
    }
    let mut chars = path.chars();
    query
        .chars()
        .all(|wanted| chars.by_ref().any(|value| value == wanted))
        .then_some(3)
}

fn project_files(root: &Path, query: &str) -> Result<Vec<String>, String> {
    if !root.is_dir() {
        return Err("项目目录不存在或无法访问。".into());
    }
    if query.len() > 512 {
        return Err("文件搜索内容过长。".into());
    }
    let query = query
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_lowercase();
    let start = Instant::now();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .require_git(false)
        .follow_links(false)
        .max_depth(Some(32))
        .filter_entry(|entry| {
            entry.depth() == 0
                || !matches!(entry.file_name().to_str(), Some(".git" | "node_modules"))
        })
        .build();
    let mut matches = Vec::new();
    for entry in walker.take(50_000) {
        if start.elapsed() > Duration::from_millis(750) {
            break;
        }
        let Ok(entry) = entry else {
            continue;
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let Some(path) = entry.path().strip_prefix(root).ok().and_then(Path::to_str) else {
            continue;
        };
        if path.contains(['\n', '\r']) {
            continue;
        }
        let path = path.replace('\\', "/");
        if let Some(rank) = score(&path, &query) {
            matches.push((rank, path));
        }
    }
    matches.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.len().cmp(&b.1.len()))
            .then_with(|| a.1.cmp(&b.1))
    });
    Ok(matches.into_iter().take(40).map(|(_, path)| path).collect())
}

#[tauri::command]
pub async fn pi_project_files(
    manager: State<'_, PiManager>,
    instance_id: String,
    query: String,
) -> Result<Vec<String>, String> {
    // Resolve the root from this runtime, never from a webview-supplied filesystem path.
    let root = manager.client(&instance_id).await?.project_path.clone();
    tauri::async_runtime::spawn_blocking(move || project_files(Path::new(&root), &query))
        .await
        .map_err(|_| "无法搜索项目文件。")?
}

#[tauri::command]
pub async fn pi_compact(
    manager: State<'_, PiManager>,
    instance_id: String,
    run_id: String,
    instructions: String,
) -> Result<(), String> {
    if uuid::Uuid::parse_str(&run_id).is_err() {
        return Err("无效的运行标识。".into());
    }
    if instructions.len() > 16 * 1024 {
        return Err("压缩说明过长。".into());
    }
    let client = manager.client(&instance_id).await?;
    let _action = client.actions.lock().await;
    let snapshot = client.snapshot().await?;
    if snapshot.read_only.is_some() {
        return Err("此会话为只读。".into());
    }
    client
        .request(
            json!({"type":"compact", "customInstructions":instructions}),
            Some(run_id),
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_only_loaded_skills_and_never_exposes_internal_commands() {
        let commands = skill_commands(&json!({"commands":[
            {"source":"extension","name":"hearth-permission"},
            {"source":"prompt","name":"review"},
            {"source":"skill","name":"skill:design","description":"Design UI"},
            {"source":"skill","name":"skill:design"},
            {"source":"skill","name":"bad name"}
        ]}));
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "skill:design");
        assert_eq!(commands[0].description, "Design UI");
    }

    #[test]
    fn file_search_respects_ignores_and_ranks_relative_unicode_paths() {
        let root = std::env::temp_dir().join(format!("hearth-files-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src/中文 目录")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/lib")).unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();
        for path in [
            "ignored.txt",
            "node_modules/lib/index.ts",
            "src/中文 目录/composer.tsx",
            "src/other.ts",
        ] {
            std::fs::write(root.join(path), "").unwrap();
        }
        assert_eq!(
            project_files(&root, "cmp").unwrap(),
            ["src/中文 目录/composer.tsx"]
        );
        assert_eq!(
            project_files(&root, "src\\中文").unwrap(),
            ["src/中文 目录/composer.tsx"]
        );
        let all = project_files(&root, "").unwrap();
        assert!(
            !all.iter()
                .any(|path| path.contains("ignored") || path.contains("node_modules"))
        );
        assert!(
            all.iter()
                .all(|path| !path.starts_with('/') && !path.contains('\\'))
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
