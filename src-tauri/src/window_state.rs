#[cfg(windows)]
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

#[cfg(windows)]
struct StartupCloak(usize);

#[cfg(windows)]
impl StartupCloak {
    fn new(window: &tauri::WebviewWindow) -> tauri::Result<Self> {
        let cloak = Self(window.hwnd()?.0 as usize);
        cloak.set(true);
        Ok(cloak)
    }

    fn set(&self, cloaked: bool) {
        use windows_sys::Win32::Graphics::Dwm::{DWMWA_CLOAK, DwmSetWindowAttribute};
        let value = i32::from(cloaked);
        let result = unsafe {
            DwmSetWindowAttribute(
                self.0 as _,
                DWMWA_CLOAK as u32,
                &value as *const _ as *const _,
                std::mem::size_of::<i32>() as u32,
            )
        };
        if result < 0 {
            eprintln!("无法更新启动窗口可见性：{result:#x}");
        }
    }
}

#[cfg(windows)]
impl Drop for StartupCloak {
    fn drop(&mut self) {
        self.set(false);
    }
}

#[derive(Default)]
pub struct Persistence {
    ready: AtomicBool,
    revision: AtomicU64,
    presented: AtomicBool,
    #[cfg(windows)]
    startup: Mutex<Option<StartupCloak>>,
}

fn flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_window_state::Builder::default()
        .with_state_flags(flags())
        .with_filter(|label| label == "main")
        .skip_initial_state("main")
        .build()
}

pub fn restore_and_show(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        // Settle frameless metrics while cloaked, then wait for the first frontend frame.
        #[cfg(windows)]
        let cloak = StartupCloak::new(&window)?;
        #[cfg(windows)]
        window.show()?;
        if let Err(error) = window.restore_state(flags()) {
            eprintln!("无法恢复窗口状态：{error}");
        }
        app.state::<Persistence>()
            .ready
            .store(true, Ordering::SeqCst);
        #[cfg(windows)]
        {
            *app.state::<Persistence>()
                .startup
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = Some(cloak);
        }
        // Failed navigation must not leave the application permanently hidden.
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Err(error) = present(&handle) {
                    eprintln!("无法显示启动窗口：{error}");
                }
            });
        });
    }
    Ok(())
}

#[tauri::command]
pub fn window_startup_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只有主窗口可以完成启动。".into());
    }
    present(window.app_handle()).map_err(|error| error.to_string())
}

fn present(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<Persistence>();
    if state.presented.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(windows)]
        drop(
            state
                .startup
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .take(),
        );
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

pub fn save(app: &AppHandle) {
    if let Err(error) = app.save_window_state(flags()) {
        eprintln!("无法保存窗口状态：{error}");
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let app = window.app_handle();
    if window.label() != "main"
        || !app.state::<Persistence>().ready.load(Ordering::SeqCst)
        || app.state::<crate::desktop::Lifecycle>().is_shutting_down()
    {
        return;
    }
    match event {
        WindowEvent::CloseRequested { .. } => save(app),
        WindowEvent::Moved(_)
        | WindowEvent::Resized(_)
        | WindowEvent::ScaleFactorChanged { .. } => {
            let revision = app
                .state::<Persistence>()
                .revision
                .fetch_add(1, Ordering::SeqCst)
                + 1;
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(300)).await;
                if app.state::<Persistence>().revision.load(Ordering::SeqCst) != revision
                    || app.state::<crate::desktop::Lifecycle>().is_shutting_down()
                {
                    return;
                }
                let handle = app.clone();
                if let Err(error) = app.run_on_main_thread(move || {
                    if handle
                        .state::<Persistence>()
                        .revision
                        .load(Ordering::SeqCst)
                        == revision
                        && !handle
                            .state::<crate::desktop::Lifecycle>()
                            .is_shutting_down()
                    {
                        save(&handle);
                    }
                }) {
                    eprintln!("无法安排窗口状态保存：{error}");
                }
            });
        }
        _ => {}
    }
}
