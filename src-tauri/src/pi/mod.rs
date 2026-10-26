pub mod attachments;
pub mod catalog;
mod client;
pub mod composer;
mod config;
pub mod files;
pub(crate) mod process_tree;
mod protocol;
pub mod resources;
mod rewrite;
mod search;
mod session_pool;
pub mod storage;
mod tool_output;
mod types;

pub use catalog::WorkspaceManager;
pub use client::PiManager;
use serde_json::json;
use tauri::{Manager, State, ipc::Channel};
use types::{PiEvent, RuntimeSnapshot, ToolLogPage};

#[tauri::command]
pub async fn pi_tool_decide(
    manager: State<'_, PiManager>,
    instance_id: String,
    approval_id: String,
    allow: bool,
) -> Result<(), String> {
    manager
        .client(&instance_id)
        .await?
        .decide(approval_id, allow)
        .await
}

#[tauri::command]
pub async fn pi_tool_output(
    manager: State<'_, PiManager>,
    instance_id: String,
    tool_id: String,
    section: String,
    offset: u32,
) -> Result<ToolLogPage, String> {
    manager
        .tool_output(&instance_id, tool_id, section, offset)
        .await
}

#[tauri::command]
pub async fn pi_connect(
    app: tauri::AppHandle,
    manager: State<'_, PiManager>,
    project_path: String,
    on_event: Channel<PiEvent>,
) -> Result<RuntimeSnapshot, String> {
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位应用数据目录。")?;
    manager.connect(project_path, &data, on_event).await
}

#[tauri::command]
pub async fn pi_send(
    app: tauri::AppHandle,
    manager: State<'_, PiManager>,
    attachments: State<'_, attachments::AttachmentManager>,
    instance_id: String,
    run_id: String,
    message: String,
    attachment_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let attachment_ids = attachment_ids.unwrap_or_default();
    if message.trim().is_empty() && attachment_ids.is_empty() {
        return Err("请输入消息。".into());
    }
    if message.len() > 256 * 1024 {
        return Err("消息过长，请缩短后重试。".into());
    }
    if uuid::Uuid::parse_str(&run_id).is_err() {
        return Err("无效的运行标识。".into());
    }
    let body = attachments.prompt(&message, &attachment_ids)?;
    let client = manager.client(&instance_id).await?;
    let _action = client.actions.lock().await;
    files::prepare_runtime(&app).await?;
    client.request(body, Some(run_id)).await?;
    attachments.release(&attachment_ids);
    Ok(())
}

#[tauri::command]
pub async fn pi_rewrite(
    app: tauri::AppHandle,
    manager: State<'_, PiManager>,
    instance_id: String,
    run_id: String,
    message_id: String,
    message: Option<String>,
) -> Result<(), String> {
    if uuid::Uuid::parse_str(&run_id).is_err() {
        return Err("无效的运行标识。".into());
    }
    let client = manager.client(&instance_id).await?;
    let _action = client.actions.lock().await;
    files::prepare_runtime(&app).await?;
    client
        .rewrite(&message_id, message.as_deref(), run_id)
        .await
}

#[tauri::command]
pub async fn pi_stop(manager: State<'_, PiManager>, instance_id: String) -> Result<(), String> {
    let client = manager.client(&instance_id).await?;
    // Queued input is cleared before abort, so stopping cannot launch another turn.
    let result = async {
        client.request(json!({"type":"clear_queue"}), None).await?;
        client.request(json!({"type":"abort"}), None).await?;
        Ok::<(), String>(())
    }
    .await;
    if result.is_err() {
        client.shutdown().await;
    }
    result
}

#[tauri::command]
pub async fn pi_set_model(
    manager: State<'_, PiManager>,
    instance_id: String,
    provider: String,
    model_id: String,
) -> Result<RuntimeSnapshot, String> {
    let trace = crate::developer::Operation::start("切换模型", || {
        format!("{provider}/{model_id} instance={instance_id}")
    });
    let result = async {
        let client = manager.client(&instance_id).await?;
        let _action = client.actions.lock().await;
        let snapshot = client.snapshot().await?;
        if snapshot
            .model
            .as_ref()
            .is_some_and(|model| model.provider == provider && model.id == model_id)
        {
            return Ok(snapshot);
        }
        client
            .request(
                json!({"type":"set_model","provider":provider,"modelId":model_id}),
                None,
            )
            .await?;
        client.request(json!({"type":"get_state"}), None).await?;
        client
            .request(json!({"type":"get_available_thinking_levels"}), None)
            .await?;
        client.snapshot().await
    }
    .await;
    trace.finish(&result);
    result
}

#[tauri::command]
pub async fn pi_set_thinking_level(
    manager: State<'_, PiManager>,
    instance_id: String,
    level: String,
) -> Result<RuntimeSnapshot, String> {
    let trace = crate::developer::Operation::start("切换思考强度", || {
        format!("{level} instance={instance_id}")
    });
    let result = async {
        let client = manager.client(&instance_id).await?;
        let _action = client.actions.lock().await;
        let snapshot = client.snapshot().await?;
        let level = if level == "default" {
            let model = snapshot.model.as_ref().ok_or("请先选择模型。")?;
            config::default_thinking_level(
                &config::local_agent_directory()?,
                &model.provider,
                &model.id,
            )?
        } else {
            if !snapshot.available_thinking_levels.contains(&level) {
                return Err("当前模型不支持这个思考档位。".into());
            }
            level
        };
        if snapshot.thinking_level == level {
            return Ok(snapshot);
        }
        client
            .request(json!({"type":"set_thinking_level","level":level}), None)
            .await?;
        client.request(json!({"type":"get_state"}), None).await?;
        client.snapshot().await
    }
    .await;
    trace.finish(&result);
    result
}

#[tauri::command]
pub async fn pi_set_permission(
    manager: State<'_, PiManager>,
    instance_id: String,
    mode: types::PermissionMode,
) -> Result<RuntimeSnapshot, String> {
    let client = manager.client(&instance_id).await?;
    let _action = client.actions.lock().await;
    client.set_permission(mode).await
}

#[tauri::command]
pub async fn pi_disconnect(
    manager: State<'_, PiManager>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<(), String> {
    workspace.cancel_open();
    manager.disconnect().await;
    Ok(())
}
