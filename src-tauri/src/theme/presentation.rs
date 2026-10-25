use std::{
    mem::size_of,
    ptr::{null, null_mut},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{Manager, WindowEvent};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, POINT, RECT, SIZE},
    Graphics::{Dwm::*, Gdi::*},
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::*,
};

struct Scene {
    cover: usize,
}
impl Drop for Scene {
    fn drop(&mut self) {
        unsafe {
            DestroyWindow(self.cover as HWND);
        }
    }
}

struct VisibleRegion {
    source: HWND,
    bounds: RECT,
    clear: bool,
    found: bool,
}
unsafe extern "system" fn check_occlusion(hwnd: HWND, data: LPARAM) -> i32 {
    let region = unsafe { &mut *(data as *mut VisibleRegion) };
    if hwnd == region.source {
        region.found = true;
        return 0;
    }
    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return 1;
    }
    // Ignore click-through compositor decorations such as cursor highlights.
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    if style & (WS_EX_LAYERED | WS_EX_TRANSPARENT) == (WS_EX_LAYERED | WS_EX_TRANSPARENT) {
        return 1;
    }
    let mut cloaked = 0_i32;
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as _,
            &mut cloaked as *mut _ as _,
            size_of::<i32>() as _,
        );
    }
    if cloaked != 0 {
        return 1;
    }
    let mut bounds: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut bounds) } != 0
        && bounds.left < region.bounds.right
        && bounds.right > region.bounds.left
        && bounds.top < region.bounds.bottom
        && bounds.bottom > region.bounds.top
    {
        region.clear = false;
        return 0;
    }
    1
}

struct Bitmap {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
}
impl Drop for Bitmap {
    fn drop(&mut self) {
        unsafe {
            if !self.previous.is_null() && self.previous as isize != -1 {
                SelectObject(self.dc, self.previous);
            }
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap);
            }
            if !self.dc.is_null() {
                DeleteDC(self.dc);
            }
        }
    }
}
impl Bitmap {
    fn capture(origin: POINT, width: i32, height: i32) -> Option<Self> {
        let screen = unsafe { GetDC(null_mut()) };
        if screen.is_null() {
            return None;
        }
        let dc = unsafe { CreateCompatibleDC(screen) };
        let bitmap = unsafe { CreateCompatibleBitmap(screen, width, height) };
        let mut image = Self {
            dc,
            bitmap,
            previous: null_mut(),
        };
        let success = if dc.is_null() || bitmap.is_null() {
            false
        } else {
            unsafe {
                image.previous = SelectObject(dc, bitmap);
                !image.previous.is_null()
                    && image.previous as isize != -1
                    && BitBlt(
                        dc,
                        0,
                        0,
                        width,
                        height,
                        screen,
                        origin.x,
                        origin.y,
                        SRCCOPY | CAPTUREBLT,
                    ) != 0
            }
        };
        unsafe {
            ReleaseDC(null_mut(), screen);
        }
        success.then_some(image)
    }
}

impl Scene {
    fn capture(source: HWND) -> Option<Self> {
        let mut bounds: RECT = unsafe { std::mem::zeroed() };
        let mut origin = POINT { x: 0, y: 0 };
        if unsafe { GetForegroundWindow() } != source
            || unsafe { IsIconic(source) } != 0
            || unsafe { GetClientRect(source, &mut bounds) } == 0
            || unsafe { ClientToScreen(source, &mut origin) } == 0
            || bounds.right <= 0
            || bounds.bottom <= 0
        {
            return None;
        }
        let screen_bounds = RECT {
            left: origin.x,
            top: origin.y,
            right: origin.x + bounds.right,
            bottom: origin.y + bounds.bottom,
        };
        let mut region = VisibleRegion {
            source,
            bounds: screen_bounds,
            clear: true,
            found: false,
        };
        unsafe {
            EnumWindows(Some(check_occlusion), &mut region as *mut _ as _);
        }
        // Do not snapshot UI covered by another interactive application.
        if !region.clear || !region.found {
            return None;
        }
        let image = Bitmap::capture(origin, bounds.right, bounds.bottom)?;
        static CLASS: OnceLock<Vec<u16>> = OnceLock::new();
        let class = CLASS.get_or_init(|| {
            let name: Vec<u16> = "PiHearthThemePresentation\0".encode_utf16().collect();
            let definition = WNDCLASSW {
                lpfnWndProc: Some(DefWindowProcW),
                hInstance: unsafe { GetModuleHandleW(null()) },
                lpszClassName: name.as_ptr(),
                ..unsafe { std::mem::zeroed() }
            };
            unsafe {
                RegisterClassW(&definition);
            }
            name
        });
        let cover = unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_LAYERED,
                class.as_ptr(),
                class.as_ptr(),
                WS_POPUP,
                origin.x,
                origin.y,
                bounds.right,
                bounds.bottom,
                source,
                null_mut(),
                GetModuleHandleW(null()),
                null(),
            )
        };
        if cover.is_null() {
            return None;
        }
        let scene = Self {
            cover: cover as usize,
        };
        let source_origin = POINT { x: 0, y: 0 };
        let size = SIZE {
            cx: bounds.right,
            cy: bounds.bottom,
        };
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as _,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: 0,
        };
        unsafe {
            if UpdateLayeredWindow(
                cover,
                null_mut(),
                &origin,
                &size,
                image.dc,
                &source_origin,
                0,
                &blend,
                ULW_ALPHA,
            ) == 0
            {
                return None;
            }
            ShowWindow(cover, SW_SHOWNOACTIVATE);
            SetWindowPos(
                cover,
                HWND_TOP,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            // Publish the complete old scene before changing Mica underneath it.
            if DwmFlush() < 0 {
                return None;
            }
        }
        Some(scene)
    }
}

#[derive(Default)]
struct Pending {
    request: String,
    scene: Option<Scene>,
}
#[derive(Default)]
pub struct Presentation(Mutex<Pending>);

pub fn begin(window: &tauri::WebviewWindow, request: &str) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let state = window.state::<Presentation>();
    let mut pending = state.0.lock().unwrap_or_else(|error| error.into_inner());
    pending.request = request.to_owned();
    if pending.scene.is_none() {
        pending.scene = Scene::capture(hwnd.0 as HWND);
    }
    drop(pending);
    let window = window.clone();
    let request = request.to_owned();
    // A stopped or reloaded renderer must not leave the old scene on screen.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(600)).await;
        let app = window.app_handle().clone();
        let _ = app.run_on_main_thread(move || finish(&window, Some(&request)));
    });
}

pub fn finish(window: &tauri::WebviewWindow, request: Option<&str>) {
    let state = window.state::<Presentation>();
    let mut pending = state.0.lock().unwrap_or_else(|error| error.into_inner());
    if request.is_some_and(|request| request != pending.request) {
        return;
    }
    if pending.scene.is_some() {
        // Reveal the material and the completed WebView surface together.
        unsafe {
            DwmFlush();
        }
    }
    pending.scene.take();
}

pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() == "main"
        && matches!(
            event,
            WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::Focused(false)
                | WindowEvent::CloseRequested { .. }
                | WindowEvent::Destroyed
        )
        && let Some(webview) = window.app_handle().get_webview_window("main")
    {
        finish(&webview, None);
    }
}
