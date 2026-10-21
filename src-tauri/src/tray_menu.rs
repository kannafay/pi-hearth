use crate::desktop::{self, Lifecycle, Shutdown};
use serde::{Deserialize, Serialize};
use std::sync::{
    Mutex,
    atomic::{AtomicU64, Ordering},
};
use tauri::{
    App, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Theme, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

#[cfg(windows)]
mod windows;

const LABEL: &str = "tray-menu";
const WIDTH: f64 = 208.0;
const HEIGHT: f64 = 148.0;
const INSET: f64 = 12.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Bounds {
    fn contains(self, x: i32, y: i32) -> bool {
        x >= self.x
            && y >= self.y
            && x < self.x + self.width as i32
            && y < self.y + self.height as i32
    }
}

fn place_popup(cursor: PhysicalPosition<f64>, area: Bounds, scale: f64) -> Bounds {
    let width = ((WIDTH * scale).ceil() as u32).min(area.width);
    let height = ((HEIGHT * scale).ceil() as u32).min(area.height);
    let inset = (INSET * scale).round() as i32;
    let gap = (4.0 * scale).round() as i32;
    let cursor_x = cursor.x.round() as i32;
    let cursor_y = cursor.y.round() as i32;
    let right = cursor_x - inset;
    let left = cursor_x - width as i32 + inset;
    let below = cursor_y + gap - inset;
    let above = cursor_y - height as i32 + inset - gap;
    Bounds {
        x: (if right + width as i32 <= area.x + area.width as i32 {
            right
        } else {
            left
        })
        .clamp(area.x, area.x + (area.width - width) as i32),
        y: (if below + height as i32 <= area.y + area.height as i32 {
            below
        } else {
            above
        })
        .clamp(area.y, area.y + (area.height - height) as i32),
        width,
        height,
    }
}

#[derive(Clone)]
struct Anchor {
    position: PhysicalPosition<f64>,
}

#[derive(Clone, Copy)]
struct Presentation {
    epoch: u64,
    foreground: usize,
    content: Bounds,
}

#[derive(Default)]
struct ContentState {
    ready: bool,
    pending: Option<Anchor>,
    presentation: Option<Presentation>,
}

#[derive(Default)]
pub struct TrayMenuState {
    epoch: AtomicU64,
    content: Mutex<ContentState>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MenuSignal {
    Open {
        epoch: u64,
        dark: bool,
    },
    Key {
        epoch: u64,
        key: String,
        shift: bool,
    },
}

fn current(window: &WebviewWindow, epoch: u64) -> bool {
    window
        .app_handle()
        .state::<TrayMenuState>()
        .epoch
        .load(Ordering::SeqCst)
        == epoch
}

fn hide(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    return windows::hide(window);
    #[cfg(not(windows))]
    window.hide().map_err(|e| e.to_string())
}

fn dismiss(window: &WebviewWindow, epoch: u64) -> Result<(), String> {
    let state = window.app_handle().state::<TrayMenuState>();
    if state
        .epoch
        .compare_exchange(
            epoch,
            epoch.wrapping_add(1),
            Ordering::SeqCst,
            Ordering::SeqCst,
        )
        .is_ok()
    {
        hide(window)?;
    }
    Ok(())
}

pub fn create(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let popup = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("tray.html".into()))
        .title("Pi Hearth 菜单")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        // A notification-area flyout must keep its foreground activation.
        .focusable(!cfg!(windows))
        .focused(false)
        .visible(false)
        .build()?;
    #[cfg(windows)]
    windows::configure(&popup)?;
    let handle = popup.clone();
    popup.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. }
            if !handle.app_handle().state::<Lifecycle>().is_shutting_down() =>
        {
            api.prevent_close();
            let epoch = handle
                .app_handle()
                .state::<TrayMenuState>()
                .epoch
                .load(Ordering::SeqCst);
            let _ = dismiss(&handle, epoch);
        }
        #[cfg(not(windows))]
        tauri::WindowEvent::Focused(false) => {
            let epoch = handle
                .app_handle()
                .state::<TrayMenuState>()
                .epoch
                .load(Ordering::SeqCst);
            let _ = dismiss(&handle, epoch);
        }
        _ => {}
    });
    Ok(())
}

pub fn show(app: &AppHandle, position: PhysicalPosition<f64>) -> Result<(), String> {
    if app.state::<Lifecycle>().is_shutting_down() {
        return Ok(());
    }
    let state = app.state::<TrayMenuState>();
    {
        let mut content = state.content.lock().map_err(|e| e.to_string())?;
        if !content.ready {
            content.pending = Some(Anchor { position });
            return Ok(());
        }
    }
    let popup = app.get_webview_window(LABEL).ok_or("托盘菜单尚未就绪。")?;
    let monitor = app
        .monitor_from_point(position.x, position.y)
        .map_err(|e| e.to_string())?
        .or(app.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("无法定位托盘所在屏幕。")?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let bounds = place_popup(
        position,
        Bounds {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        },
        scale,
    );
    let epoch = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
    hide(&popup)?;
    popup
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    popup
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())?;
    let theme = app
        .get_webview_window("main")
        .and_then(|window| window.theme().ok())
        .unwrap_or(Theme::Light);
    popup.set_theme(Some(theme)).map_err(|e| e.to_string())?;
    let inset = (INSET * scale).round() as u32;
    let presentation = Presentation {
        epoch,
        #[cfg(windows)]
        foreground: windows::foreground(),
        #[cfg(not(windows))]
        foreground: 0,
        content: Bounds {
            x: bounds.x + inset as i32,
            y: bounds.y + inset as i32,
            width: bounds.width.saturating_sub(inset * 2),
            height: bounds.height.saturating_sub(inset * 2),
        },
    };
    state
        .content
        .lock()
        .map_err(|e| e.to_string())?
        .presentation = Some(presentation);
    // The page acknowledges its rendered theme before the native window appears.
    popup
        .emit(
            "tray-menu-signal",
            MenuSignal::Open {
                epoch,
                dark: theme == Theme::Dark,
            },
        )
        .map_err(|e| e.to_string())
}

fn require_popup(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("此操作仅可从托盘菜单发起。".into());
    }
    Ok(())
}

#[tauri::command]
pub fn tray_ready(window: WebviewWindow) -> Result<(), String> {
    require_popup(&window)?;
    let pending = {
        let state = window.app_handle().state::<TrayMenuState>();
        let mut content = state.content.lock().map_err(|e| e.to_string())?;
        content.ready = true;
        content.pending.take()
    };
    if let Some(anchor) = pending {
        show(window.app_handle(), anchor.position)?;
    }
    Ok(())
}

#[tauri::command]
pub fn tray_present(window: WebviewWindow, epoch: u64) -> Result<(), String> {
    require_popup(&window)?;
    if !current(&window, epoch) {
        return Ok(());
    }
    let presentation = window
        .app_handle()
        .state::<TrayMenuState>()
        .content
        .lock()
        .map_err(|e| e.to_string())?
        .presentation
        .filter(|presentation| presentation.epoch == epoch);
    let Some(presentation) = presentation else {
        return Ok(());
    };
    #[cfg(windows)]
    if !windows::same_foreground(presentation.foreground) {
        return dismiss(&window, epoch);
    }
    #[cfg(windows)]
    windows::present(window, presentation)?;
    #[cfg(not(windows))]
    {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn tray_dismiss(window: WebviewWindow, epoch: u64) -> Result<(), String> {
    require_popup(&window)?;
    dismiss(&window, epoch)
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayAction {
    Show,
    Restart,
    Quit,
}

#[tauri::command]
pub fn tray_action(window: WebviewWindow, epoch: u64, action: TrayAction) -> Result<(), String> {
    require_popup(&window)?;
    if !current(&window, epoch) || window.app_handle().state::<Lifecycle>().is_shutting_down() {
        return Ok(());
    }
    dismiss(&window, epoch)?;
    match action {
        TrayAction::Show => desktop::show_window(window.app_handle()).map_err(|e| e.to_string()),
        TrayAction::Restart | TrayAction::Quit => {
            desktop::shutdown(
                window.app_handle(),
                if matches!(action, TrayAction::Restart) {
                    Shutdown::Restart
                } else {
                    Shutdown::Exit(0)
                },
            );
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn popup_opens_at_the_cursor_and_flips_at_screen_edges() {
        let area = Bounds {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let popup = place_popup(PhysicalPosition::new(800.0, 500.0), area, 1.0);
        assert_eq!(popup.x + INSET as i32, 800);
        assert_eq!(popup.y + INSET as i32, 504);

        let popup = place_popup(PhysicalPosition::new(1812.0, 992.0), area, 1.0);
        assert_eq!(popup.x + popup.width as i32 - INSET as i32, 1812);
        assert_eq!(popup.y + popup.height as i32 - INSET as i32, 988);

        // A click on the taskbar still keeps the entire popup in the work area.
        let popup = place_popup(PhysicalPosition::new(1900.0, 1060.0), area, 1.0);
        assert_eq!(popup.y + popup.height as i32, 1040);
    }
    #[test]
    fn popup_and_click_bounds_match_on_scaled_and_negative_monitors() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let area = Bounds {
                x: -2560,
                y: -200,
                width: 2560,
                height: 1440,
            };
            for x in [-2560, -1280, -1] {
                for y in [-200, 500, 1239, 1260] {
                    let cursor = PhysicalPosition::new(x as f64, y as f64);
                    let popup = place_popup(cursor, area, scale);
                    assert!(
                        popup.x >= area.x
                            && popup.x + popup.width as i32 <= area.x + area.width as i32
                    );
                    assert!(
                        popup.y >= area.y
                            && popup.y + popup.height as i32 <= area.y + area.height as i32
                    );
                    assert!(popup.contains(popup.x, popup.y));
                    assert!(!popup.contains(popup.x + popup.width as i32, popup.y));
                    assert!(!popup.contains(popup.x, popup.y + popup.height as i32));
                }
            }
            let cursor = PhysicalPosition::new(-1280.0, 500.0);
            let popup = place_popup(cursor, area, scale);
            let inset = (INSET * scale).round() as i32;
            let gap = (4.0 * scale).round() as i32;
            assert_eq!(popup.x + inset, cursor.x as i32);
            assert_eq!(popup.y + inset, cursor.y as i32 + gap);
        }
    }
}
