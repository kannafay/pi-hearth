use crate::pi::{PiManager, WorkspaceManager};
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(not(windows))]
use tauri::menu::{Menu, MenuItem};
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
    #[cfg(windows)]
    crate::tray_menu::create(app)?;
    let icon = app.default_window_icon().ok_or("缺少应用图标。")?.clone();
    let builder = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("Pi Hearth")
        .show_menu_on_left_click(false);
    #[cfg(not(windows))]
    let builder = {
        let show = MenuItem::with_id(app, "show", "界面", true, None::<&str>)?;
        let restart = MenuItem::with_id(app, "restart", "重启", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &restart, &quit])?;
        builder
            .menu(&menu)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    let _ = show_window(app);
                }
                "restart" => shutdown(app, Shutdown::Restart),
                "quit" => shutdown(app, Shutdown::Exit(0)),
                _ => {}
            })
    };
    builder
        .on_tray_icon_event(|tray, event| {
            if tray.app_handle().state::<Lifecycle>().is_shutting_down() {
                return;
            }
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) && !tray.app_handle().state::<Lifecycle>().is_shutting_down()
            {
                let _ = toggle_window(tray.app_handle());
            }
            #[cfg(windows)]
            if let TrayIconEvent::Click {
                button: MouseButton::Right,
                button_state: MouseButtonState::Up,
                position,
                rect,
                ..
            } = event
                && let Err(error) = crate::tray_menu::show(tray.app_handle(), position, rect)
            {
                eprintln!("Unable to open tray menu: {error}");
            }
        })
        .build(app)?;
    Ok(())
}
