mod pi;

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::Manager;

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(windows)]
    let context = {
        let mut context = context;
        if let Some(window) = context
            .config_mut()
            .app
            .windows
            .iter_mut()
            .find(|window| window.label == "main")
        {
            window.transparent = true;
            window.window_effects = Some(
                tauri::window::EffectsBuilder::new()
                    .effect(tauri::window::Effect::Mica)
                    .build(),
            );
        }
        context
    };
    let shutting_down = Arc::new(AtomicBool::new(false));
    tauri::Builder::default()
        .manage(pi::PiManager::default())
        .manage(pi::WorkspaceManager::default())
        .manage(pi::attachments::AttachmentManager::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            pi::attachments::attachment_paths,
            pi::attachments::attachment_bytes,
            pi::attachments::attachment_clipboard,
            pi::attachments::attachment_release,
            pi::attachments::attachment_preview,
            pi::catalog::workspace_catalog,
            pi::catalog::workspace_search,
            pi::catalog::workspace_select,
            pi::catalog::workspace_add_project,
            pi::catalog::project_instructions,
            pi::catalog::pi_open,
            pi::pi_connect,
            pi::pi_send,
            pi::pi_stop,
            pi::pi_set_model,
            pi::pi_tool_decide,
            pi::pi_tool_output,
            pi::pi_disconnect
        ])
        .build(context)
        .expect("failed to build pi-hearth")
        .run(move |app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event
                && !shutting_down.swap(true, Ordering::SeqCst)
            {
                api.prevent_exit();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    app.state::<pi::PiManager>().disconnect().await;
                    app.exit(0);
                });
            }
        });
}
