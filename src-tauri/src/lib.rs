mod desktop;
mod pi;
#[cfg(windows)]
mod theme;
#[cfg(not(windows))]
mod tray_menu;
#[cfg(windows)]
#[path = "tray_menu/native.rs"]
mod tray_menu;

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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if !app.state::<desktop::Lifecycle>().is_shutting_down() {
                let _ = desktop::show_window(app);
            }
        }))
        .manage(desktop::Lifecycle::default())
        .manage(pi::PiManager::default())
        .manage(pi::WorkspaceManager::default())
        .manage(pi::attachments::AttachmentManager::default())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(not(windows))]
    let builder = builder.manage(tray_menu::TrayMenuState::default());
    builder
        .setup(desktop::setup)
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
                && !window
                    .app_handle()
                    .state::<desktop::Lifecycle>()
                    .is_shutting_down()
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            #[cfg(windows)]
            theme::get_system_theme,
            #[cfg(not(windows))]
            tray_menu::tray_ready,
            #[cfg(not(windows))]
            tray_menu::tray_present,
            #[cfg(not(windows))]
            tray_menu::tray_dismiss,
            #[cfg(not(windows))]
            tray_menu::tray_closed,
            #[cfg(not(windows))]
            tray_menu::tray_action,
            pi::attachments::attachment_paths,
            pi::attachments::attachment_bytes,
            pi::attachments::attachment_clipboard,
            pi::attachments::attachment_clipboard_available,
            pi::attachments::attachment_release,
            pi::attachments::attachment_preview,
            pi::storage::app_settings,
            pi::storage::app_update_settings,
            pi::catalog::workspace_catalog,
            pi::catalog::workspace_search,
            pi::catalog::workspace_select,
            pi::catalog::workspace_update_session,
            pi::catalog::workspace_delete_archived,
            pi::catalog::workspace_add_project,
            pi::catalog::workspace_update_project,
            pi::catalog::workspace_remove_project,
            pi::catalog::workspace_project_directory,
            pi::catalog::workspace_open_project_folder,
            pi::catalog::project_instructions,
            pi::catalog::pi_open,
            pi::pi_connect,
            pi::pi_send,
            pi::pi_rewrite,
            pi::pi_stop,
            pi::pi_set_model,
            pi::pi_set_thinking_level,
            pi::pi_tool_decide,
            pi::pi_tool_output,
            pi::pi_disconnect
        ])
        .build(context)
        .expect("failed to build pi-hearth")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event
                && code != Some(tauri::RESTART_EXIT_CODE)
                && !app.state::<desktop::Lifecycle>().is_shutting_down()
            {
                api.prevent_exit();
                desktop::shutdown(app, desktop::Shutdown::Exit(code.unwrap_or(0)));
            }
        });
}
