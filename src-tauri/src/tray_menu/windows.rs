use super::{Bounds, MenuSignal, Presentation, current, dismiss};
use std::{
    cell::RefCell,
    ptr::null_mut,
    time::{Duration, Instant},
};
use tauri::{Emitter, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
    UI::{
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_CONTROL, VK_DOWN, VK_END, VK_ESCAPE, VK_HOME, VK_LWIN, VK_MENU,
            VK_RETURN, VK_RWIN, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
        },
        WindowsAndMessaging::*,
    },
};

const INPUT: u32 = WM_APP + 41;
const DISMISS: u32 = WM_APP + 42;

struct Context {
    thread: u32,
    bounds: Bounds,
    held: [bool; 256],
    closing: bool,
}

thread_local! {
    static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) };
}

pub(super) fn foreground() -> usize {
    unsafe { GetForegroundWindow() as usize }
}

pub(super) fn same_foreground(owner: usize) -> bool {
    let active = foreground();
    owner == 0 || active == 0 || active == owner
}

fn menu_key(key: u16) -> Option<&'static str> {
    match key {
        VK_DOWN => Some("ArrowDown"),
        VK_UP => Some("ArrowUp"),
        VK_HOME => Some("Home"),
        VK_END => Some("End"),
        VK_RETURN => Some("Enter"),
        VK_SPACE => Some(" "),
        VK_ESCAPE => Some("Escape"),
        VK_TAB => Some("Tab"),
        _ => None,
    }
}

pub(super) fn hide(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    window
        .run_on_main_thread(move || {
            unsafe { ShowWindow(hwnd as _, SW_HIDE) };
        })
        .map_err(|e| e.to_string())
}

pub(super) fn configure(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    window
        .run_on_main_thread(move || unsafe {
            let hwnd = hwnd as _;
            // Keep the popup out of the taskbar while allowing foreground
            // activation, so the shell can dismiss its notification-area flyout.
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            SetWindowLongPtrW(
                hwnd,
                GWL_STYLE,
                ((style & !WS_OVERLAPPEDWINDOW) | WS_POPUP) as isize,
            );
            let extended = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                ((extended & !(WS_EX_APPWINDOW | WS_EX_NOACTIVATE)) | WS_EX_TOOLWINDOW) as isize,
            );
            SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        })
        .map_err(|e| e.to_string())
}

pub(super) fn present(window: WebviewWindow, presentation: Presentation) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    let popup = window.clone();
    window
        .run_on_main_thread(move || {
            if !current(&popup, presentation.epoch) {
                return;
            }
            if !same_foreground(presentation.foreground) {
                let _ = dismiss(&popup, presentation.epoch);
                return;
            }
            // Reinsert the popup above the shell flyout before activation.
            if unsafe {
                SetWindowPos(
                    hwnd as _,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
                )
            } == 0
            {
                eprintln!("Cannot show tray menu: {}", std::io::Error::last_os_error());
                let _ = dismiss(&popup, presentation.epoch);
                return;
            }
            // A tray context menu must own foreground activation. Leaving it
            // with the shell strands the overflow flyout after our menu closes.
            unsafe { SetForegroundWindow(hwnd as _) };
            if foreground() != hwnd {
                let _ = dismiss(&popup, presentation.epoch);
                return;
            }
            let presentation = Presentation {
                foreground: hwnd,
                ..presentation
            };
            if let Err(error) = watch(popup.clone(), presentation) {
                eprintln!("Cannot monitor tray menu input: {error}");
                let _ = dismiss(&popup, presentation.epoch);
                return;
            }
            if popup
                .emit(
                    "tray-menu-signal",
                    MenuSignal::Shown {
                        epoch: presentation.epoch,
                    },
                )
                .is_err()
            {
                let _ = dismiss(&popup, presentation.epoch);
            }
        })
        .map_err(|e| e.to_string())
}

unsafe extern "system" fn keyboard(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    let handled = if code == 0 {
        // Windows owns this structure for the duration of the hook callback.
        let key = unsafe { &*(data as *const KBDLLHOOKSTRUCT) }.vkCode as u16;
        if menu_key(key).is_none() {
            false
        } else {
            CONTEXT.with(|context| {
                let mut context = context.borrow_mut();
                let Some(context) = context.as_mut() else {
                    return false;
                };
                let index = key as usize;
                if matches!(message as u32, WM_KEYUP | WM_SYSKEYUP) {
                    let consumed = context.held[index];
                    context.held[index] = false;
                    return consumed;
                }
                if !matches!(message as u32, WM_KEYDOWN | WM_SYSKEYDOWN) || context.closing {
                    return context.held[index];
                }
                if [VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN]
                    .iter()
                    .any(|key| unsafe { GetAsyncKeyState(*key as i32) } < 0)
                {
                    unsafe { PostThreadMessageW(context.thread, DISMISS, 0, 0) };
                    return context.held[index];
                }
                context.held[index] = true;
                // Only menu-navigation keys are consumed; no text is recorded.
                // Queue work so the input hook never waits for WebView IPC.
                let shift = unsafe { GetAsyncKeyState(VK_SHIFT as i32) } < 0;
                unsafe { PostThreadMessageW(context.thread, INPUT, key as usize, shift as isize) };
                true
            })
        }
    } else {
        false
    };
    if handled {
        1
    } else {
        unsafe { CallNextHookEx(null_mut(), code, message, data) }
    }
}

unsafe extern "system" fn mouse(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code == 0
        && matches!(
            message as u32,
            WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN
        )
    {
        let point = unsafe { &*(data as *const MSLLHOOKSTRUCT) }.pt;
        CONTEXT.with(|context| {
            if let Some(context) = context.borrow().as_ref()
                && !context.closing
                && !context.bounds.contains(point.x, point.y)
            {
                unsafe { PostThreadMessageW(context.thread, DISMISS, 0, 0) };
            }
        });
    }
    // Outside clicks still reach their normal target.
    unsafe { CallNextHookEx(null_mut(), code, message, data) }
}

struct Hooks {
    keyboard: HHOOK,
    mouse: HHOOK,
    timer: usize,
}

impl Drop for Hooks {
    fn drop(&mut self) {
        unsafe {
            if !self.keyboard.is_null() {
                UnhookWindowsHookEx(self.keyboard);
            }
            if !self.mouse.is_null() {
                UnhookWindowsHookEx(self.mouse);
            }
            if self.timer != 0 {
                KillTimer(null_mut(), self.timer);
            }
        }
        CONTEXT.with(|context| *context.borrow_mut() = None);
    }
}

fn watch(window: WebviewWindow, presentation: Presentation) -> Result<(), String> {
    std::thread::Builder::new()
        .name("tray-menu-input".into())
        .spawn(move || {
            // Hooks exist only while this menu is open (plus held-key release).
            let module = unsafe { GetModuleHandleW(std::ptr::null()) };
            let hooks = Hooks {
                keyboard: unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), module, 0) },
                mouse: unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), module, 0) },
                timer: unsafe { SetTimer(null_mut(), 0, 30, None) },
            };
            if hooks.keyboard.is_null() || hooks.mouse.is_null() || hooks.timer == 0 {
                let _ = dismiss(&window, presentation.epoch);
                return;
            }
            CONTEXT.with(|context| {
                *context.borrow_mut() = Some(Context {
                    thread: unsafe { GetCurrentThreadId() },
                    bounds: presentation.content,
                    held: [false; 256],
                    closing: false,
                });
            });
            let mut closing_since: Option<Instant> = None;
            let mut message: MSG = unsafe { std::mem::zeroed() };
            while unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } > 0 {
                let open = current(&window, presentation.epoch)
                    && window.is_visible().unwrap_or(false)
                    && same_foreground(presentation.foreground);
                if !open {
                    let _ = dismiss(&window, presentation.epoch);
                    closing_since.get_or_insert_with(Instant::now);
                    let held = CONTEXT.with(|context| {
                        let mut context = context.borrow_mut();
                        let context = context.as_mut().unwrap();
                        context.closing = true;
                        context.held.iter().any(|held| *held)
                    });
                    if !held || closing_since.unwrap().elapsed() > Duration::from_millis(500) {
                        break;
                    }
                    continue;
                }
                match message.message {
                    DISMISS => {
                        let _ = dismiss(&window, presentation.epoch);
                    }
                    INPUT => {
                        if let Some(key) = menu_key(message.wParam as u16) {
                            if key == "Escape" {
                                let _ = dismiss(&window, presentation.epoch);
                            } else {
                                let _ = window.emit(
                                    "tray-menu-signal",
                                    MenuSignal::Key {
                                        epoch: presentation.epoch,
                                        key: key.into(),
                                        shift: message.lParam != 0,
                                    },
                                );
                            }
                        }
                    }
                    _ => {}
                }
            }
        })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_menu_navigation_keys_are_intercepted() {
        for key in [
            VK_DOWN, VK_UP, VK_HOME, VK_END, VK_RETURN, VK_SPACE, VK_ESCAPE, VK_TAB,
        ] {
            assert!(menu_key(key).is_some());
        }
        for key in [0x41, 0x30, 0x70, VK_SHIFT] {
            assert!(menu_key(key).is_none());
        }
    }
}
