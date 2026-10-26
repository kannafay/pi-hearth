use super::{
    catalog,
    client::PiManager,
    config::{local_agent_directory, prepare_config, redact},
    types::{ModelInfo, ResourceCatalog},
};
use serde_json::json;
use std::{collections::HashMap, path::Path};
use tauri::{Manager, State};
use tokio::sync::Mutex;

pub(super) async fn preferences(data: &Path) -> Result<HashMap<String, bool>, String> {
    match tokio::fs::read(data.join("resources.json")).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "资源启停设置格式有误。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(_) => Err("无法读取资源启停设置。".into()),
    }
}

pub(super) async fn save_preferences(
    data: &Path,
    settings: &HashMap<String, bool>,
) -> Result<(), String> {
    tokio::fs::create_dir_all(data)
        .await
        .map_err(|_| "无法创建资源设置目录。")?;
    let temporary = data.join("resources.json.tmp");
    tokio::fs::write(&temporary, serde_json::to_vec(settings).unwrap())
        .await
        .map_err(|_| "无法保存资源启停设置。")?;
    tokio::fs::rename(temporary, data.join("resources.json"))
        .await
        .map_err(|_| "无法保存资源启停设置。".into())
}

fn key(kind: &str, source: &str, name: &str) -> String {
    serde_json::to_string(&(kind, source, name)).unwrap()
}

async fn list(data: &Path, project_path: Option<String>) -> Result<ResourceCatalog, String> {
    let value = catalog::helper(
        data,
        json!({"action":"resources", "projectPath":project_path}),
    )
    .await?;
    let mut result: ResourceCatalog =
        serde_json::from_value(value).map_err(|_| "资源列表返回了无效数据。")?;
    let settings = preferences(data).await?;
    for (kind, items) in [("skills", &mut result.skills), ("mcp", &mut result.mcp)] {
        for item in items {
            item.enabled = settings
                .get(&key(kind, &item.source, &item.name))
                .copied()
                .unwrap_or(false);
        }
    }
    Ok(result)
}

fn find(catalog: &ResourceCatalog, kind: &str, source: &str, name: &str) -> Result<String, String> {
    let items = match kind {
        "skills" => &catalog.skills,
        "mcp" => &catalog.mcp,
        _ => return Err("无效的资源类型。".into()),
    };
    items
        .iter()
        .find(|item| item.name == name && catalog::same_path(&item.source, source))
        .map(|item| item.source.clone())
        .ok_or("资源已不存在，请刷新列表。".into())
}

#[tauri::command]
pub async fn pi_resources(
    app: tauri::AppHandle,
    project_path: Option<String>,
) -> Result<ResourceCatalog, String> {
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位应用数据目录。")?;
    list(&data, project_path).await
}

#[tauri::command]
pub async fn pi_resource_toggle(
    app: tauri::AppHandle,
    manager: State<'_, PiManager>,
    project_path: Option<String>,
    kind: String,
    source: String,
    name: String,
    enabled: bool,
) -> Result<ResourceCatalog, String> {
    static UPDATE: Mutex<()> = Mutex::const_new(());
    let _gate = UPDATE.lock().await;
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位应用数据目录。")?;
    let catalog = list(&data, project_path.clone()).await?;
    let source = find(&catalog, &kind, &source, &name)?;
    let mut settings = preferences(&data).await?;
    settings.insert(key(&kind, &source, &name), enabled);
    manager.configure_resources(&data, &settings).await?;
    list(&data, project_path).await
}

#[tauri::command]
pub async fn pi_resource_open(
    app: tauri::AppHandle,
    project_path: Option<String>,
    kind: String,
    source: String,
    name: String,
) -> Result<(), String> {
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位应用数据目录。")?;
    let source = find(&list(&data, project_path).await?, &kind, &source, &name)?;
    let file = dunce::canonicalize(source).map_err(|_| "资源文件不存在或无法访问。")?;
    if !file.is_file()
        || !file
            .extension()
            .is_some_and(|extension| extension == "md" || extension == "json")
    {
        return Err("只能打开技能或 MCP 配置文件。".into());
    }
    catalog::open_path(&file)
}

#[tauri::command]
pub async fn pi_models(app: tauri::AppHandle) -> Result<Vec<ModelInfo>, String> {
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位应用数据目录。")?;
    let preview = data
        .join("runtime")
        .join(format!("model-catalog-{}", uuid::Uuid::new_v4()));
    let config = prepare_config(&local_agent_directory()?, &preview)?;
    let result = catalog::helper_with_environment(
        &data,
        json!({"action":"models", "directory":preview}),
        config.environment,
    )
    .await;
    let _ = tokio::fs::remove_dir_all(&preview).await;
    let value = result.map_err(|error| redact(error, &config.secrets))?;
    serde_json::from_value(value).map_err(|_| "模型列表返回了无效数据。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn preferences_keep_each_resource_independent_after_reopen() {
        let data = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/resource-preferences-test")
            .join(uuid::Uuid::new_v4().to_string());
        let one = key("mcp", "C:/agent/mcp.json", "one");
        let two = key("mcp", "C:/agent/mcp.json", "two");
        let skill = key("skills", "D:/project/SKILL.md", "review");
        let mut expected =
            HashMap::from([(one.clone(), true), (two.clone(), false), (skill, true)]);
        save_preferences(&data, &expected).await.unwrap();
        assert_eq!(preferences(&data).await.unwrap(), expected);
        expected.insert(one, false);
        expected.insert(two, true);
        save_preferences(&data, &expected).await.unwrap();
        assert_eq!(preferences(&data).await.unwrap(), expected);
    }
    #[test]
    fn file_opening_only_accepts_entries_from_the_current_catalog() {
        let catalog: ResourceCatalog = serde_json::from_value(json!({"skills":[{"name":"review","source":"D:/project/SKILL.md","description":"","scope":"project","status":"unloaded","manualOnly":false}],"mcp":[],"warnings":[]})).unwrap();
        assert_eq!(
            find(&catalog, "skills", "D:/project/SKILL.md", "review").unwrap(),
            "D:/project/SKILL.md"
        );
        assert!(find(&catalog, "skills", "C:/unknown.exe", "review").is_err());
        assert!(find(&catalog, "mcp", "D:/project/SKILL.md", "review").is_err());
    }
}
