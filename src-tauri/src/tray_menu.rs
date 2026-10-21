#[cfg(windows)]
use crate::desktop::Lifecycle;
use crate::desktop::{self, Shutdown};
use serde::Deserialize;
#[cfg(windows)]
use tauri::{App, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindowBuilder};
use tauri::{AppHandle, WebviewWindow};

const LABEL: &str = "tray-menu";
#[cfg(any(windows, test))]
const WIDTH: f64 = 208.0;
#[cfg(any(windows, test))]
const HEIGHT: f64 = 129.0;

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[cfg(any(windows, test))]
fn place_popup(cursor_x: f64, icon: Bounds, area: Bounds, scale: f64) -> Bounds {
    let width = ((WIDTH * scale).ceil() as u32).min(area.width);
    let height = ((HEIGHT * scale).ceil() as u32).min(area.height);
    let gap = (4.0 * scale).round() as i32;
    let above = icon.y - height as i32 - gap;
    let y = if above >= area.y {
        above
    } else {
        icon.y + icon.height as i32 + gap
    };
    Bounds {
        x: ((cursor_x + 8.0 * scale).round() as i32 - width as i32)
            .clamp(area.x, area.x + (area.width - width) as i32),
        y: y.clamp(area.y, area.y + (area.height - height) as i32),
        width,
        height,
    }
}

#[cfg(windows)]
pub fn create(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let theme = app
        .get_webview_window("main")
        .and_then(|window| window.theme().ok());
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
        .focused(false)
        .visible(false)
        .theme(theme)
        .build()?;
    let handle = popup.clone();
    popup.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(false) => {
            let _ = handle.hide();
        }
        tauri::WindowEvent::CloseRequested { api, .. }
            if !handle.app_handle().state::<Lifecycle>().is_shutting_down() =>
        {
            api.prevent_close();
            let _ = handle.hide();
        }
        _ => {}
    });
    Ok(())
}

#[cfg(windows)]
pub fn show(app: &AppHandle, position: PhysicalPosition<f64>, icon: Rect) -> Result<(), String> {
    let popup = app.get_webview_window(LABEL).ok_or("托盘菜单尚未就绪。")?;
    let monitor = app
        .monitor_from_point(position.x, position.y)
        .map_err(|e| e.to_string())?
        .or(app.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("无法定位托盘所在屏幕。")?;
    let scale = monitor.scale_factor();
    let icon_position = icon.position.to_physical::<i32>(scale);
    let icon_size = icon.size.to_physical::<u32>(scale);
    let work = monitor.work_area();
    let bounds = place_popup(
        position.x,
        Bounds {
            x: icon_position.x,
            y: icon_position.y,
            width: icon_size.width,
            height: icon_size.height,
        },
        Bounds {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        },
        scale,
    );
    if let Some(main) = app.get_webview_window("main") {
        popup
            .set_theme(main.theme().ok())
            .map_err(|e| e.to_string())?;
    }
    popup
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    popup
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())?;
    popup.show().map_err(|e| e.to_string())?;
    popup.set_focus().map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayAction {
    Show,
    Restart,
    Quit,
}

fn require_popup(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("此操作仅可从托盘菜单发起。".into());
    }
    Ok(())
}

#[tauri::command]
pub fn tray_dismiss(window: WebviewWindow) -> Result<(), String> {
    require_popup(&window)?;
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tray_action(
    app: AppHandle,
    window: WebviewWindow,
    action: TrayAction,
) -> Result<(), String> {
    require_popup(&window)?;
    match action {
        TrayAction::Show => {
            desktop::show_window(&app).map_err(|e| e.to_string())?;
            window.hide().map_err(|e| e.to_string())?;
        }
        TrayAction::Restart | TrayAction::Quit => {
            window.hide().map_err(|e| e.to_string())?;
            desktop::shutdown(
                &app,
                if matches!(action, TrayAction::Restart) {
                    Shutdown::Restart
                } else {
                    Shutdown::Exit(0)
                },
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn popup_stays_in_the_work_area_on_scaled_and_negative_monitors() {
        for (scale, area, icon, cursor) in [
            (
                1.0,
                Bounds {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1040,
                },
                Bounds {
                    x: 1880,
                    y: 1040,
                    width: 32,
                    height: 40,
                },
                1900.0,
            ),
            (
                2.0,
                Bounds {
                    x: -2560,
                    y: 0,
                    width: 2560,
                    height: 1400,
                },
                Bounds {
                    x: -64,
                    y: 1400,
                    width: 64,
                    height: 80,
                },
                -10.0,
            ),
            (
                1.25,
                Bounds {
                    x: 0,
                    y: 48,
                    width: 1920,
                    height: 1032,
                },
                Bounds {
                    x: 0,
                    y: 0,
                    width: 40,
                    height: 48,
                },
                20.0,
            ),
        ] {
            let popup = place_popup(cursor, icon, area, scale);
            assert!(
                popup.x >= area.x && popup.x + popup.width as i32 <= area.x + area.width as i32
            );
            assert!(
                popup.y >= area.y && popup.y + popup.height as i32 <= area.y + area.height as i32
            );
            if icon.y >= area.y + area.height as i32 {
                assert!(popup.y + (popup.height as i32) < icon.y);
            }
            if icon.y < area.y {
                assert!(popup.y >= area.y);
            }
        }
    }
}
