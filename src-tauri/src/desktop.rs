use crate::pi::{PiManager, WorkspaceManager};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    App, AppHandle, Manager,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

#[derive(Default)]
pub struct Lifecycle {
    shutting_down: AtomicBool,
}

impl Lifecycle {
    pub fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
    }
}

pub enum Shutdown {
    Exit(i32),
    Restart,
}

// Stop the managed agent before either exit path; repeated menu clicks share it.
pub fn shutdown(app: &AppHandle, action: Shutdown) {
    if app
        .state::<Lifecycle>()
        .shutting_down
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    crate::window_state::save(app);
    app.state::<WorkspaceManager>().cancel_open();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        app.state::<PiManager>().disconnect().await;
        if let Ok(data) = crate::app_data::directory(&app) {
            let _ = crate::developer::set_enabled(&data, false);
        }
        match action {
            Shutdown::Exit(code) => app.exit(code),
            Shutdown::Restart => app.request_restart(),
        }
    });
}

pub fn show_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();
    let cleanup_app = handle.clone();
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            timer.tick().await;
            if cleanup_app.state::<Lifecycle>().is_shutting_down() {
                break;
            }
            cleanup_app.state::<PiManager>().release_idle().await;
        }
    });
    let _ = tauri::async_runtime::block_on(async {
        let _gate = crate::developer::SETTINGS_GATE.lock().await;
        let data = crate::app_data::directory(handle)?;
        let settings = crate::pi::storage::settings(&data).await?;
        crate::developer::set_enabled(&data, settings.developer_mode)
    });
    #[cfg(windows)]
    crate::theme::install(app.handle())?;
    #[cfg(windows)]
    let menu = crate::tray_menu::create(app)?;
    #[cfg(not(windows))]
    crate::tray_menu::create(app)?;
    let icon = app.default_window_icon().ok_or("缺少应用图标。")?.clone();
    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("Pi Hearth")
        .on_tray_icon_event(|tray, event| {
            if tray.app_handle().state::<Lifecycle>().is_shutting_down() {
                return;
            }
            match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    let _ = show_window(tray.app_handle());
                }
                #[cfg(not(windows))]
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    position,
                    ..
                } => {
                    let _ = crate::tray_menu::show(tray.app_handle(), position);
                }
                _ => {}
            }
        });
    #[cfg(windows)]
    let tray = tray
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(crate::tray_menu::on_menu_event);
    let _tray = tray.build(app)?;
    #[cfg(windows)]
    crate::tray_menu::apply_style(&_tray, &menu)?;
    crate::window_state::restore_and_show(app.handle())?;
    Ok(())
}
