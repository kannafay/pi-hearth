use crate::desktop::{self, Lifecycle, Shutdown};
use serde::{Deserialize, Serialize};
use std::sync::{
    Mutex,
    atomic::{AtomicU64, Ordering},
};
use std::time::Duration;
use tauri::{
    App, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Theme, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

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
    let inset = (INSET * scale).round() as i32;
    // Only the visible card is constrained; transparent shadow padding may cross
    // a work-area edge without moving the menu away from the click.
    let width = ((WIDTH * scale).ceil() as u32 - 2 * inset as u32).min(area.width);
    let height = ((HEIGHT * scale).ceil() as u32 - 2 * inset as u32).min(area.height);
    let gap = (4.0 * scale).round() as i32;
    let cursor_x = cursor.x.round() as i32;
    let cursor_y = cursor.y.round() as i32;
    let right = cursor_x;
    let left = cursor_x - width as i32;
    let below = cursor_y + gap;
    let above = cursor_y - height as i32 - gap;
    Bounds {
        x: (if right + width as i32 <= area.x + area.width as i32 {
            right
        } else {
            left
        })
        .clamp(area.x, area.x + (area.width - width) as i32)
            - inset,
        y: (if below + height as i32 <= area.y + area.height as i32 {
            below
        } else {
            above
        })
        .clamp(area.y, area.y + (area.height - height) as i32)
            - inset,
        width: width + 2 * inset as u32,
        height: height + 2 * inset as u32,
    }
}

fn placement_area(cursor: PhysicalPosition<f64>, work: Bounds, screen: Bounds) -> Bounds {
    // Like Windows context menus, a click on the taskbar uses the whole monitor
    // instead of being pulled back into the desktop work area.
    if work.contains(cursor.x.round() as i32, cursor.y.round() as i32) {
        work
    } else {
        screen
    }
}

fn transform_origin(cursor: PhysicalPosition<f64>, content: Bounds) -> &'static str {
    match (
        cursor.x <= content.x as f64 + content.width as f64 / 2.0,
        cursor.y <= content.y as f64 + content.height as f64 / 2.0,
    ) {
        (true, true) => "left top",
        (false, true) => "right top",
        (true, false) => "left bottom",
        (false, false) => "right bottom",
    }
}

#[derive(Clone)]
struct Anchor {
    position: PhysicalPosition<f64>,
}

#[derive(Clone, Copy)]
struct Presentation {
    epoch: u64,
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

impl TrayMenuState {
    fn begin_close(&self, epoch: u64) -> bool {
        self.epoch
            .compare_exchange(
                epoch,
                epoch.wrapping_add(1),
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    fn is_closing(&self, epoch: u64) -> bool {
        self.epoch.load(Ordering::SeqCst) == epoch.wrapping_add(1)
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MenuSignal {
    Open {
        epoch: u64,
        dark: bool,
        origin: &'static str,
    },
    Shown {
        epoch: u64,
    },
    Close {
        epoch: u64,
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
    window.hide().map_err(|e| e.to_string())
}

fn finish_close(window: &WebviewWindow, epoch: u64) -> Result<(), String> {
    let popup = window.clone();
    window
        .run_on_main_thread(move || {
            // Check again on the UI thread: an older fade-out or timeout must
            // never hide a menu that has since been opened again.
            if popup
                .app_handle()
                .state::<TrayMenuState>()
                .is_closing(epoch)
            {
                let _ = hide(&popup);
            }
        })
        .map_err(|e| e.to_string())
}

fn dismiss(window: &WebviewWindow, epoch: u64) -> Result<(), String> {
    if !window
        .app_handle()
        .state::<TrayMenuState>()
        .begin_close(epoch)
    {
        return Ok(());
    }
    if window
        .emit("tray-menu-signal", MenuSignal::Close { epoch })
        .is_err()
    {
        return finish_close(window, epoch);
    }
    let popup = window.clone();
    tauri::async_runtime::spawn(async move {
        // The normal hide is acknowledged after the 80ms fade. A stalled page
        // or missing transition event must still release the native surface.
        tokio::time::sleep(Duration::from_millis(250)).await;
        let _ = finish_close(&popup, epoch);
    });
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
        .focused(false)
        .visible(false)
        .build()?;
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
    let area = placement_area(
        position,
        Bounds {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        },
        Bounds {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        },
    );
    let bounds = place_popup(position, area, scale);
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
                origin: transform_origin(position, presentation.content),
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
    if presentation.is_none() {
        return Ok(());
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window
        .emit("tray-menu-signal", MenuSignal::Shown { epoch })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn tray_dismiss(window: WebviewWindow, epoch: u64) -> Result<(), String> {
    require_popup(&window)?;
    dismiss(&window, epoch)
}

#[tauri::command]
pub fn tray_closed(window: WebviewWindow, epoch: u64) -> Result<(), String> {
    require_popup(&window)?;
    finish_close(&window, epoch)
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
    fn animation_origin_tracks_the_corner_nearest_the_click() {
        let content = Bounds {
            x: 600,
            y: 400,
            width: 184,
            height: 124,
        };
        for (x, y, expected) in [
            (598.0, 396.0, "left top"),
            (788.0, 396.0, "right top"),
            (598.0, 528.0, "left bottom"),
            (788.0, 528.0, "right bottom"),
        ] {
            assert_eq!(
                transform_origin(PhysicalPosition::new(x, y), content),
                expected
            );
        }
    }

    #[test]
    fn old_close_acknowledgements_and_timeouts_cannot_hide_a_reopened_menu() {
        let state = TrayMenuState::default();
        state.epoch.store(7, Ordering::SeqCst);
        assert!(!state.is_closing(7));
        assert!(state.begin_close(7));
        assert!(state.is_closing(7));
        assert!(!state.begin_close(7));
        let reopened = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        assert_eq!(reopened, 9);
        assert!(!state.is_closing(7));
        assert!(!state.begin_close(7));
        assert!(state.begin_close(reopened));
        assert!(state.is_closing(reopened));
    }

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

        let popup = place_popup(PhysicalPosition::new(0.0, 0.0), area, 1.0);
        assert_eq!(popup.x + INSET as i32, 0);
        assert_eq!(popup.y + INSET as i32, 4);
    }

    #[test]
    fn taskbar_clicks_stay_near_the_pointer_without_a_shadow_sized_gap() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let screen = Bounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            };
            let work = Bounds {
                height: 1020,
                ..screen
            };
            let cursor = PhysicalPosition::new(1200.0, 1050.0);
            let area = placement_area(cursor, work, screen);
            assert_eq!(area, screen);
            let popup = place_popup(cursor, area, scale);
            let inset = (INSET * scale).round() as i32;
            let gap = (4.0 * scale).round() as i32;
            assert_eq!(popup.x + inset, cursor.x as i32);
            assert_eq!(popup.y + popup.height as i32 - inset, cursor.y as i32 - gap);

            let cursor = PhysicalPosition::new(1200.0, 1000.0);
            assert_eq!(placement_area(cursor, work, screen), work);
            let popup = place_popup(PhysicalPosition::new(1200.0, 1019.0), work, scale);
            assert_eq!(popup.y + popup.height as i32 - inset, 1019 - gap);
        }
    }

    #[test]
    fn taskbars_on_any_screen_edge_use_the_monitor_containing_the_click() {
        let screen = Bounds {
            x: -1920,
            y: -1080,
            width: 1920,
            height: 1080,
        };
        let work = Bounds {
            x: -1860,
            y: -1020,
            width: 1800,
            height: 960,
        };
        for cursor in [
            PhysicalPosition::new(-1890.0, -500.0),
            PhysicalPosition::new(-30.0, -500.0),
            PhysicalPosition::new(-900.0, -1050.0),
            PhysicalPosition::new(-900.0, -30.0),
        ] {
            assert_eq!(placement_area(cursor, work, screen), screen);
        }
        assert_eq!(
            placement_area(PhysicalPosition::new(-900.0, -500.0), work, screen),
            work
        );
    }
    #[test]
    fn popup_and_click_bounds_match_on_scaled_and_negative_monitors() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let inset = (INSET * scale).round() as i32;
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
                        popup.x + inset >= area.x
                            && popup.x + popup.width as i32 - inset <= area.x + area.width as i32
                    );
                    assert!(
                        popup.y + inset >= area.y
                            && popup.y + popup.height as i32 - inset <= area.y + area.height as i32
                    );
                    assert!(popup.contains(popup.x, popup.y));
                    assert!(!popup.contains(popup.x + popup.width as i32, popup.y));
                    assert!(!popup.contains(popup.x, popup.y + popup.height as i32));
                }
            }
            let cursor = PhysicalPosition::new(-1280.0, 500.0);
            let popup = place_popup(cursor, area, scale);
            let gap = (4.0 * scale).round() as i32;
            assert_eq!(popup.x + inset, cursor.x as i32);
            assert_eq!(popup.y + inset, cursor.y as i32 + gap);
        }
    }
}
