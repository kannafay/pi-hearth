use super::{
    catalog,
    client::{PiManager, pi_runtime_path},
    config::{local_agent_directory, prepare_config, redact},
    types::{ModelInfo, ResourceCatalog},
};
use serde_json::json;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
use tauri::State;
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
    apply_preferences(&mut result, &preferences(data).await?);
    Ok(result)
}

fn apply_preferences(result: &mut ResourceCatalog, settings: &HashMap<String, bool>) {
    for (kind, items) in [("skills", &mut result.skills), ("mcp", &mut result.mcp)] {
        for item in items {
            item.enabled = settings
                .get(&key(kind, &item.source, &item.name))
                .copied()
                .unwrap_or(item.enabled);
        }
    }
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
pub fn pi_runtime_version() -> Result<String, String> {
    runtime_version(&pi_runtime_path()?)
}

fn runtime_version(entrypoint: &Path) -> Result<String, String> {
    let package = entrypoint
        .ancestors()
        .nth(3)
        .ok_or("无法定位 Pi 运行时版本信息。")?
        .join("package.json");
    let bytes = std::fs::read(package).map_err(|_| "无法读取 Pi 运行时版本信息。")?;
    let package: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "Pi 运行时版本信息格式有误。")?;
    package["version"]
        .as_str()
        .filter(|version| !version.trim().is_empty())
        .map(str::to_owned)
        .ok_or("Pi 运行时版本信息缺少版本号。".into())
}

#[tauri::command]
pub fn pi_config_directory(open: bool) -> Result<String, String> {
    let directory: PathBuf = local_agent_directory()?.components().collect();
    if open {
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建 Pi 配置目录。")?;
        catalog::open_path(&directory)?;
    }
    Ok(directory.to_string_lossy().into())
}

#[tauri::command]
pub async fn pi_resources(
    app: tauri::AppHandle,
    project_path: Option<String>,
) -> Result<ResourceCatalog, String> {
    let data = crate::app_data::directory(&app)?;
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
    let data = crate::app_data::directory(&app)?;
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
    let data = crate::app_data::directory(&app)?;
    let source = find(&list(&data, project_path).await?, &kind, &source, &name)?;
    let target = open_target(&kind, &source)?;
    if kind == "mcp" {
        catalog::reveal_path(&target)
    } else {
        catalog::open_path(&target)
    }
}

fn open_target(kind: &str, source: &str) -> Result<PathBuf, String> {
    let file = dunce::canonicalize(source).map_err(|_| "资源文件不存在或无法访问。")?;
    if !file.is_file()
        || !file
            .extension()
            .is_some_and(|extension| extension == "md" || extension == "json")
    {
        return Err("只能打开技能或 MCP 配置文件。".into());
    }
    match kind {
        "skills" => file
            .parent()
            .map(Path::to_path_buf)
            .ok_or("无法定位资源目录。".into()),
        "mcp" => Ok(file),
        _ => Err("无效的资源类型。".into()),
    }
}

#[tauri::command]
pub async fn pi_models(app: tauri::AppHandle) -> Result<Vec<ModelInfo>, String> {
    let data = crate::app_data::directory(&app)?;
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
    let mut models: Vec<ModelInfo> =
        serde_json::from_value(value).map_err(|_| "模型列表返回了无效数据。")?;
    for model in &mut models {
        model.provider_name = config.provider_names.get(&model.provider).cloned();
    }
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_comes_from_the_package_that_owns_the_runtime_entrypoint() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/pi-version-test")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(root.join("dist/bundle")).unwrap();
        std::fs::write(root.join("package.json"), r#"{"version":"7.8.9"}"#).unwrap();
        assert_eq!(
            runtime_version(&root.join("dist/bundle/cli.js")).unwrap(),
            "7.8.9"
        );
        for (contents, message) in [
            ("{}", "Pi 运行时版本信息缺少版本号。"),
            (r#"{"version":" "}"#, "Pi 运行时版本信息缺少版本号。"),
            ("invalid json", "Pi 运行时版本信息格式有误。"),
        ] {
            std::fs::write(root.join("package.json"), contents).unwrap();
            assert_eq!(
                runtime_version(&root.join("dist/bundle/cli.js")).unwrap_err(),
                message
            );
        }
        assert_eq!(
            runtime_version(&root.join("missing/dist/bundle/cli.js")).unwrap_err(),
            "无法读取 Pi 运行时版本信息。"
        );
        assert_eq!(
            runtime_version(Path::new("cli.js")).unwrap_err(),
            "无法定位 Pi 运行时版本信息。"
        );
    }

    #[test]
    fn skill_opening_targets_the_directory_and_mcp_reveals_the_exact_file() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/resource-open-test")
            .join(uuid::Uuid::new_v4().to_string());
        let directory = root.join("skills/review");
        std::fs::create_dir_all(&directory).unwrap();
        let skill = directory.join("SKILL.md");
        let mcp = root.join("mcp.json");
        std::fs::write(&skill, "Test skill.").unwrap();
        std::fs::write(&mcp, "{}").unwrap();
        assert_eq!(
            open_target("skills", skill.to_str().unwrap()).unwrap(),
            dunce::canonicalize(directory).unwrap()
        );
        assert_eq!(
            open_target("mcp", mcp.to_str().unwrap()).unwrap(),
            dunce::canonicalize(&mcp).unwrap()
        );
        assert!(open_target("skills", root.join("missing.md").to_str().unwrap()).is_err());
        assert!(open_target("other", mcp.to_str().unwrap()).is_err());
    }

    #[test]
    fn desktop_overrides_preserve_unmodified_pi_defaults() {
        let item = |name: &str, enabled: bool| json!({"name":name,"description":"","source":"C:/agent/config","scope":"global","status":"unloaded","manualOnly":false,"enabled":enabled});
        let mut catalog: ResourceCatalog = serde_json::from_value(json!({
            "skills":[item("review", true),item("manual", true)],
            "mcp":[item("docs", true),item("disabled", false)],
            "warnings":[]
        }))
        .unwrap();
        apply_preferences(&mut catalog, &HashMap::new());
        assert!(catalog.skills.iter().all(|item| item.enabled));
        assert!(catalog.mcp[0].enabled);
        assert!(!catalog.mcp[1].enabled);
        apply_preferences(
            &mut catalog,
            &HashMap::from([
                (key("skills", "C:/agent/config", "review"), false),
                (key("mcp", "C:/agent/config", "docs"), false),
                (key("mcp", "C:/agent/config", "disabled"), true),
            ]),
        );
        assert!(!catalog.skills[0].enabled);
        assert!(catalog.skills[1].enabled);
        assert!(!catalog.mcp[0].enabled);
        assert!(catalog.mcp[1].enabled);
    }

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
