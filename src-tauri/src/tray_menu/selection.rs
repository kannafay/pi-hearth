//! The system selection fade snapshots the entire rectangular menu row. End
//! our menu before that snapshot and fade a window clipped to its actual button.
use super::*;
use std::cell::RefCell;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VK_RETURN, VK_SPACE};

const FEEDBACK_STYLE: usize = 0x50494804;
const FEEDBACK_TIMER: usize = 0x50494805;
const FEEDBACK_FADE: Duration = Duration::from_millis(180);

thread_local! {
    static ACTIVE: RefCell<Option<Selection>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct Selection {
    hook: usize,
    owner: usize,
    menu: usize,
    frame: Arc<Frame>,
}

pub(super) fn begin(owner: HWND, menu: usize, frame: Arc<Frame>) {
    end();
    // Only this thread, and only while this particular tray menu is open.
    let hook = unsafe {
        SetWindowsHookExW(
            WH_MSGFILTER,
            Some(selection_input),
            std::ptr::null_mut(),
            GetCurrentThreadId(),
        )
    };
    if !hook.is_null() {
        ACTIVE.with(|active| {
            *active.borrow_mut() = Some(Selection {
                hook: hook as usize,
                owner: owner as usize,
                menu,
                frame,
            });
        });
    }
}

pub(super) fn end() {
    let previous = ACTIVE.with(|active| active.borrow_mut().take());
    if let Some(previous) = previous {
        unsafe {
            UnhookWindowsHookEx(previous.hook as _);
        }
    }
}

unsafe extern "system" fn selection_input(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == MSGF_MENU as i32 && lparam != 0 {
        let message = unsafe { &*(lparam as *const MSG) };
        let active = ACTIVE.with(|active| active.borrow().clone());
        if let Some(active) = active
            && let Some((position, item, command)) =
                activation(active.owner as _, active.menu as _, message)
        {
            let mut rect = RECT::default();
            let measured = unsafe {
                GetMenuItemRect(active.owner as _, active.menu as _, position, &mut rect)
            } != 0;
            if unsafe { EndMenu() } != 0 {
                if measured {
                    feedback(&active.frame, item, rect);
                }
                // Keep the native command ID and the existing tray event route.
                // Posting lets the menu loop finish before the action executes.
                unsafe {
                    PostMessageW(active.owner as _, WM_COMMAND, command as _, 0);
                }
                return 1;
            }
        }
    }
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
}

fn activation(owner: HWND, menu: HMENU, message: &MSG) -> Option<(u32, Item, u32)> {
    let position = match message.message {
        WM_LBUTTONUP => {
            let position = unsafe { MenuItemFromPoint(owner, menu, message.pt) };
            u32::try_from(position).ok()?
        }
        WM_KEYDOWN if matches!(message.wParam as u16, VK_RETURN | VK_SPACE) => {
            (0..4).find(|&position| unsafe {
                GetMenuState(menu, position, MF_BYPOSITION) & MF_HILITE != 0
            })?
        }
        _ => return None,
    };
    let item = match position {
        0 => Item::Show,
        1 => Item::Restart,
        3 => Item::Quit,
        _ => return None,
    };
    let mut info = MENUITEMINFOW {
        cbSize: size_of::<MENUITEMINFOW>() as _,
        fMask: MIIM_ID | MIIM_STATE | MIIM_SUBMENU,
        ..Default::default()
    };
    if unsafe { GetMenuItemInfoW(menu, position, 1, &mut info) } == 0
        || info.fState & (MFS_DISABLED | MFS_GRAYED) != 0
        || !info.hSubMenu.is_null()
    {
        return None;
    }
    Some((position, item, info.wID))
}

struct Feedback {
    image: PaintBuffer,
    started: Instant,
}

fn feedback(frame: &Frame, item: Item, rect: RECT) {
    let mut selection_fade = 0i32;
    unsafe {
        SystemParametersInfoW(
            SPI_GETSELECTIONFADE,
            0,
            &mut selection_fade as *mut _ as _,
            0,
        );
    }
    if !frame.style.animate || selection_fade == 0 {
        return;
    }
    let (width, height) = (rect.right - rect.left, rect.bottom - rect.top);
    let screen = unsafe { GetDC(std::ptr::null_mut()) };
    let image = PaintBuffer::new(screen, width, height);
    unsafe {
        ReleaseDC(std::ptr::null_mut(), screen);
    }
    let Some(image) = image else { return };
    let bounds = RECT {
        left: 0,
        top: 0,
        right: width,
        bottom: height,
    };
    let draw = DRAWITEMSTRUCT {
        hDC: image.hdc,
        rcItem: bounds,
        itemState: ODS_SELECTED,
        ..Default::default()
    };
    paint_item_contents(&draw, item, frame, Some(1.0));
    let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_TOPMOST,
            class.as_ptr(),
            std::ptr::null(),
            WS_POPUP,
            rect.left,
            rect.top,
            width,
            height,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        )
    };
    if hwnd.is_null() {
        return;
    }
    let button = button_bounds(bounds, item, &frame.style);
    let region = unsafe {
        CreateRoundRectRgn(
            button.left,
            button.top,
            button.right,
            button.bottom,
            frame.style.px(10),
            frame.style.px(10),
        )
    };
    // Never show an unmasked rectangular fallback.
    if region.is_null() || unsafe { SetWindowRgn(hwnd, region, 0) } == 0 {
        unsafe {
            if !region.is_null() {
                DeleteObject(region);
            }
            DestroyWindow(hwnd);
        }
        return;
    }
    let raw = Box::into_raw(Box::new(Feedback {
        image,
        started: Instant::now(),
    }));
    unsafe {
        if SetWindowSubclass(hwnd, Some(feedback_proc), FEEDBACK_STYLE, raw as usize) == 0 {
            drop(Box::from_raw(raw));
            DestroyWindow(hwnd);
            return;
        }
        if SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA) == 0
            || SetTimer(hwnd, FEEDBACK_TIMER, 16, None) == 0
        {
            DestroyWindow(hwnd);
            return;
        }
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        UpdateWindow(hwnd);
    }
}

unsafe extern "system" fn feedback_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass: usize,
    data: usize,
) -> LRESULT {
    let raw = data as *mut Feedback;
    match message {
        WM_PAINT => {
            let mut paint = PAINTSTRUCT::default();
            unsafe {
                let hdc = BeginPaint(hwnd, &mut paint);
                (*raw).image.present(hdc, 0, 0);
                EndPaint(hwnd, &paint);
            }
            return 0;
        }
        WM_TIMER if wparam == FEEDBACK_TIMER => {
            let progress =
                unsafe { (*raw).started.elapsed() }.as_secs_f32() / FEEDBACK_FADE.as_secs_f32();
            unsafe {
                if progress >= 1.0 {
                    DestroyWindow(hwnd);
                } else {
                    SetLayeredWindowAttributes(
                        hwnd,
                        0,
                        (255.0 * (1.0 - progress)) as u8,
                        LWA_ALPHA,
                    );
                }
            }
            return 0;
        }
        WM_NCHITTEST => return HTTRANSPARENT as _,
        WM_NCDESTROY => unsafe {
            KillTimer(hwnd, FEEDBACK_TIMER);
            RemoveWindowSubclass(hwnd, Some(feedback_proc), subclass);
            drop(Box::from_raw(raw));
        },
        _ => {}
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestMenu(HMENU);

    impl TestMenu {
        fn new() -> Self {
            let menu = unsafe { CreatePopupMenu() };
            assert!(!menu.is_null());
            let text: Vec<u16> = "item\0".encode_utf16().collect();
            for (id, flags) in [
                (401, MF_STRING),
                (402, MF_STRING),
                (0, MF_SEPARATOR),
                (403, MF_STRING),
            ] {
                assert_ne!(unsafe { AppendMenuW(menu, flags, id, text.as_ptr()) }, 0);
            }
            Self(menu)
        }

        fn highlight(&self, position: u32, flags: u32) {
            for index in 0..4 {
                let info = MENUITEMINFOW {
                    cbSize: size_of::<MENUITEMINFOW>() as _,
                    fMask: MIIM_STATE,
                    fState: if index == position {
                        flags | MFS_HILITE
                    } else {
                        0
                    },
                    ..Default::default()
                };
                assert_ne!(unsafe { SetMenuItemInfoW(self.0, index, 1, &info) }, 0);
            }
        }

        fn key(&self, key: u16) -> Option<(u32, Item, u32)> {
            activation(
                std::ptr::null_mut(),
                self.0,
                &MSG {
                    message: WM_KEYDOWN,
                    wParam: key as _,
                    ..Default::default()
                },
            )
        }
    }

    impl Drop for TestMenu {
        fn drop(&mut self) {
            unsafe {
                DestroyMenu(self.0);
            }
        }
    }

    #[test]
    fn keyboard_activation_preserves_native_command_ids() {
        for (position, id) in [(0, 401), (1, 402), (3, 403)] {
            let menu = TestMenu::new();
            menu.highlight(position, 0);
            for key in [VK_RETURN, VK_SPACE] {
                let (actual_position, _, actual_id) = menu.key(key).expect("enabled command");
                assert_eq!((actual_position, actual_id), (position, id));
            }
        }
    }

    #[test]
    fn disabled_rows_dividers_and_cancel_keys_do_not_activate() {
        let menu = TestMenu::new();
        menu.highlight(1, MFS_DISABLED);
        assert!(menu.key(VK_RETURN).is_none());
        let menu = TestMenu::new();
        menu.highlight(2, 0);
        assert!(menu.key(VK_RETURN).is_none());
        let menu = TestMenu::new();
        menu.highlight(0, 0);
        for key in [0x1b, 0x26, 0x28] {
            assert!(menu.key(key).is_none());
        }
    }
}
