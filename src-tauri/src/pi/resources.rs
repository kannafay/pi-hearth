use super::{catalog, types::ResourceCatalog};
use serde_json::json;
use tauri::Manager;

#[tauri::command]
pub async fn pi_resources(
    app: tauri::AppHandle,
    project_path: Option<String>,
) -> Result<ResourceCatalog, String> {
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位应用数据目录。")?;
    let value = catalog::helper(
        &data,
        json!({"action":"resources", "projectPath":project_path}),
    )
    .await?;
    serde_json::from_value(value).map_err(|_| "资源列表返回了无效数据。".into())
}
