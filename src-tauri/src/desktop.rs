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
    app.state::<WorkspaceManager>().cancel_open();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        app.state::<PiManager>().disconnect().await;
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

fn toggle_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main")
        && window.is_visible()?
        && !window.is_minimized()?
    {
        return window.hide();
    }
    show_window(app)
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    crate::tray_menu::create(app)?;
    let icon = app.default_window_icon().ok_or("缺少应用图标。")?.clone();
    TrayIconBuilder::with_id("main-tray")
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
                    let _ = toggle_window(tray.app_handle());
                }
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
        })
        .build(app)?;
    Ok(())
}
