use super::{catalog::default_projects_directory, storage, types::AppSettings};
use serde_json::json;
use std::path::{Path, PathBuf};

pub(super) fn default_files_directory(projects: &Path) -> PathBuf {
    let parent = projects.parent().unwrap_or(projects);
    let directory = parent.join("Files");
    if super::catalog::same_path(&directory.to_string_lossy(), &projects.to_string_lossy()) {
        parent.join("Pi Hearth Files")
    } else {
        directory
    }
}

fn resolve_directory(default_projects: &Path, settings: &AppSettings) -> PathBuf {
    if !settings.files_directory.is_empty() {
        return PathBuf::from(&settings.files_directory);
    }
    default_files_directory(default_projects)
}

pub(super) async fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data = crate::app_data::directory(app)?;
    Ok(resolve_directory(
        &default_projects_directory(app)?,
        &storage::settings(&data).await?,
    ))
}

pub(super) async fn uploads(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(directory(app).await?.join("Uploads"))
}

#[tauri::command]
pub fn workspace_files_directory(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<String, String> {
    let directory = if let Some(path) = path {
        let directory = dunce::canonicalize(path).map_err(|_| "文件目录不存在或无法访问。")?;
        if !directory.is_dir() {
            return Err("请选择文件夹。".into());
        }
        directory
    } else {
        default_files_directory(&default_projects_directory(&app)?)
    };
    Ok(directory.to_string_lossy().into())
}

pub(super) async fn prepare_runtime(app: &tauri::AppHandle) -> Result<(), String> {
    let data = crate::app_data::directory(app)?;
    let directory = directory(app).await?;
    tokio::fs::create_dir_all(directory.join("Generated"))
        .await
        .map_err(|_| "无法保存生成文件，请检查文件保存位置。")?;
    write_runtime_location(&data, &directory).await
}

async fn write_runtime_location(data: &Path, directory: &Path) -> Result<(), String> {
    let runtime = data.join("runtime");
    tokio::fs::create_dir_all(&runtime)
        .await
        .map_err(|_| "无法准备文件保存位置。")?;
    let temporary = runtime.join(format!("file-storage-{}.tmp", uuid::Uuid::new_v4()));
    tokio::fs::write(
        &temporary,
        serde_json::to_vec(&json!({"directory": directory})).unwrap(),
    )
    .await
    .map_err(|_| "无法准备文件保存位置。")?;
    if tokio::fs::rename(&temporary, runtime.join("file-storage.json"))
        .await
        .is_err()
    {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err("无法更新文件保存位置。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_location_is_independent_of_custom_project_storage() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../work/file-locations");
        let default = root.join("Pi Hearth/Projects");
        let mut settings = AppSettings::default();
        assert_eq!(
            resolve_directory(&default, &settings),
            root.join("Pi Hearth/Files")
        );
        settings.projects_directory = root.join("Custom/Projects").to_string_lossy().into();
        assert_eq!(
            resolve_directory(&default, &settings),
            root.join("Pi Hearth/Files")
        );
        settings.files_directory = root.join("Other/Assets").to_string_lossy().into();
        assert_eq!(
            resolve_directory(&default, &settings),
            root.join("Other/Assets")
        );
        settings.projects_directory.clear();
        assert_eq!(
            resolve_directory(&default, &settings),
            root.join("Other/Assets")
        );
        settings.files_directory.clear();
        assert_eq!(
            resolve_directory(&default, &settings),
            root.join("Pi Hearth/Files")
        );
        assert_ne!(
            default_files_directory(&root.join("Files")),
            root.join("Files")
        );
    }

    #[tokio::test]
    async fn runtime_location_changes_without_moving_existing_files() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/file-locations")
            .join(uuid::Uuid::new_v4().to_string());
        let first = root.join("First");
        tokio::fs::create_dir_all(&first).await.unwrap();
        tokio::fs::write(first.join("keep.txt"), "original")
            .await
            .unwrap();
        write_runtime_location(&root, &first).await.unwrap();
        let second = root.join("Second");
        write_runtime_location(&root, &second).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(
            &tokio::fs::read(root.join("runtime/file-storage.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(value["directory"], second.to_string_lossy().as_ref());
        assert_eq!(
            tokio::fs::read_to_string(first.join("keep.txt"))
                .await
                .unwrap(),
            "original"
        );
        assert!(!second.exists());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
