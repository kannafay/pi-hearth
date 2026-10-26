use super::{Action, icon};
use std::{
    ffi::c_void,
    mem::size_of,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Manager, Theme,
    image::Image,
    menu::{ContextMenu, Menu},
    tray::TrayIcon,
};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
    Graphics::{
        Dwm::{
            DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DwmSetWindowAttribute,
        },
        Gdi::*,
    },
    System::Threading::GetCurrentThreadId,
    UI::{
        Accessibility::{MSAA_MENU_SIG, MSAAMENUINFO},
        Controls::{DRAWITEMSTRUCT, MEASUREITEMSTRUCT, ODS_SELECTED, ODT_MENU},
        HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI},
        Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::*,
    },
};

const OWNER_STYLE: usize = 0x50494801;
const POPUP_STYLE: usize = 0x50494802;
const HOVER_TIMER: usize = 0x50494803;
const FADE: Duration = Duration::from_millis(100);

#[derive(Clone, Copy)]
enum Item {
    Show,
    Restart,
    Divider,
    Quit,
}

impl Item {
    fn index(self) -> usize {
        match self {
            Self::Show => 0,
            Self::Restart => 1,
            Self::Divider => 2,
            Self::Quit => 3,
        }
    }
    fn height(self) -> i32 {
        match self {
            Self::Show | Self::Quit => 34,
            Self::Restart => 30,
            Self::Divider => 9,
        }
    }
}

#[derive(Clone, Copy)]
struct Colors {
    background: [u8; 3],
    foreground: [u8; 3],
    hover: [u8; 3],
    border: [u8; 3],
    danger_hover: [u8; 3],
    danger: [u8; 3],
}

impl Colors {
    fn new(dark: bool) -> Self {
        if dark {
            Self {
                background: [23; 3],
                foreground: [250; 3],
                hover: [38; 3],
                border: [46; 3],
                danger_hover: [69, 38, 39],
                danger: [255, 100, 103],
            }
        } else {
            Self {
                background: [255; 3],
                foreground: [10; 3],
                hover: [245; 3],
                border: [229; 3],
                danger_hover: [253, 230, 231],
                danger: [231, 0, 11],
            }
        }
    }
}

struct Style {
    scale: f64,
    colors: Colors,
    font: usize,
    brush: usize,
    icons: [Image<'static>; 3],
    animate: bool,
}

impl Style {
    fn new(app: &AppHandle) -> Result<Self, String> {
        let dark = app
            .get_webview_window("main")
            .and_then(|window| window.theme().ok())
            == Some(Theme::Dark);
        let colors = Colors::new(dark);
        let mut point = POINT::default();
        let mut dpi_x = 96;
        let mut dpi_y = 96;
        unsafe {
            GetCursorPos(&mut point);
            GetDpiForMonitor(
                MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST),
                MDT_EFFECTIVE_DPI,
                &mut dpi_x,
                &mut dpi_y,
            );
        }
        let scale = dpi_x.max(96) as f64 / 96.0;
        let font_name: Vec<u16> = "Segoe UI\0".encode_utf16().collect();
        let font = unsafe {
            CreateFontW(
                -(12.0 * scale).round() as i32,
                0,
                0,
                0,
                FW_NORMAL as _,
                0,
                0,
                0,
                DEFAULT_CHARSET as _,
                OUT_DEFAULT_PRECIS as _,
                CLIP_DEFAULT_PRECIS as _,
                CLEARTYPE_QUALITY as _,
                DEFAULT_PITCH as _,
                font_name.as_ptr(),
            )
        };
        let brush = unsafe { CreateSolidBrush(rgb(colors.background)) };
        if font.is_null() || brush.is_null() {
            unsafe {
                if !font.is_null() {
                    DeleteObject(font);
                }
                if !brush.is_null() {
                    DeleteObject(brush);
                }
            }
            return Err("无法创建托盘菜单绘制资源。".into());
        }
        let size = (16.0 * scale).round() as u32;
        let mut animation = 1i32;
        unsafe {
            SystemParametersInfoW(
                SPI_GETCLIENTAREAANIMATION,
                0,
                &mut animation as *mut _ as _,
                0,
            );
        }
        Ok(Self {
            scale,
            colors,
            font: font as usize,
            brush: brush as usize,
            icons: [
                icon(Action::Show, size, colors.foreground),
                icon(Action::Restart, size, colors.foreground),
                icon(Action::Quit, size, colors.danger),
            ],
            animate: animation != 0,
        })
    }
    fn px(&self, value: i32) -> i32 {
        (value as f64 * self.scale).round() as i32
    }
}

impl Drop for Style {
    fn drop(&mut self) {
        unsafe {
            DeleteObject(self.font as _);
            DeleteObject(self.brush as _);
        }
    }
}

struct Hover {
    from: [f32; 4],
    target: [f32; 4],
    started: Instant,
    bounds: [Option<RECT>; 4],
}

impl Hover {
    fn new() -> Self {
        Self {
            from: [0.0; 4],
            target: [0.0; 4],
            started: Instant::now(),
            bounds: [None; 4],
        }
    }
    fn progress(&self, now: Instant, animate: bool) -> f32 {
        if animate {
            (now.saturating_duration_since(self.started).as_secs_f32() / FADE.as_secs_f32())
                .min(1.0)
        } else {
            1.0
        }
    }
    fn values(&self, now: Instant, animate: bool) -> [f32; 4] {
        let t = self.progress(now, animate);
        std::array::from_fn(|index| self.from[index] + (self.target[index] - self.from[index]) * t)
    }
    fn repaint_regions(&self) -> [Option<RECT>; 4] {
        std::array::from_fn(|index| {
            if self.from[index] != self.target[index] {
                self.bounds[index]
            } else {
                None
            }
        })
    }
    fn sample(&mut self, item: Item, selected: bool, now: Instant, animate: bool) -> (f32, bool) {
        let index = item.index();
        let target = if selected { 1.0 } else { 0.0 };
        if self.target[index] != target {
            self.from = self.values(now, animate);
            self.target[index] = target;
            self.started = now;
        }
        (
            self.values(now, animate)[index],
            self.progress(now, animate) < 1.0,
        )
    }
}

struct Frame {
    style: Style,
    hover: Mutex<Hover>,
    popup: AtomicUsize,
}
impl Frame {
    fn new(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            style: Style::new(app)?,
            hover: Mutex::new(Hover::new()),
            popup: AtomicUsize::new(0),
        })
    }
}
struct Owner {
    app: AppHandle,
    menu: usize,
    frame: Arc<Frame>,
    entries: [Entry; 4],
}
struct Entry {
    item: Item,
    _text: Vec<u16>,
    accessible: Box<MSAAMENUINFO>,
}
impl Entry {
    fn new(item: Item, label: &str) -> Self {
        let mut text: Vec<u16> = label.encode_utf16().chain([0]).collect();
        let accessible = Box::new(MSAAMENUINFO {
            dwMSAASignature: MSAA_MENU_SIG as _,
            cchWText: text.len() as u32 - 1,
            pszWText: text.as_mut_ptr(),
        });
        Self {
            item,
            _text: text,
            accessible,
        }
    }
    fn data(&self) -> usize {
        self.accessible.as_ref() as *const MSAAMENUINFO as usize
    }
}
impl Owner {
    fn item(&self, data: usize) -> Option<Item> {
        self.entries
            .iter()
            .find(|entry| entry.data() == data)
            .map(|entry| entry.item)
    }
}
struct Popup {
    frame: Arc<Frame>,
    size: (i32, i32),
}

pub fn install(tray: &TrayIcon, menu: &Menu<tauri::Wry>) -> Result<(), String> {
    let menu = menu.hpopupmenu().map_err(|error| error.to_string())? as usize;
    let app = tray.app_handle().clone();
    tray.with_inner_tray_icon(move |tray| install_owner(tray.window_handle(), menu, app))
        .map_err(|error| error.to_string())?
}

fn install_owner(hwnd: HWND, menu: usize, app: AppHandle) -> Result<(), String> {
    let frame = Arc::new(Frame::new(&app)?);
    let owner = Box::new(Owner {
        app,
        menu,
        frame,
        entries: [
            Entry::new(Item::Show, "界面"),
            Entry::new(Item::Restart, "重启"),
            Entry::new(Item::Divider, ""),
            Entry::new(Item::Quit, "退出"),
        ],
    });
    let raw = Box::into_raw(owner);
    if unsafe { SetWindowSubclass(hwnd, Some(owner_proc), OWNER_STYLE, raw as usize) } == 0 {
        unsafe {
            drop(Box::from_raw(raw));
        }
        return Err("无法设置托盘菜单样式。".into());
    }
    // Keep native menu IDs and strings intact for command routing,
    // accessibility and keyboard navigation. Only their drawing changes.
    for position in 0..4 {
        let info = MENUITEMINFOW {
            cbSize: size_of::<MENUITEMINFOW>() as _,
            fMask: MIIM_FTYPE | MIIM_DATA,
            fType: MFT_OWNERDRAW | if position == 2 { MFT_SEPARATOR } else { 0 },
            dwItemData: unsafe { (*raw).entries[position as usize].data() },
            ..Default::default()
        };
        if unsafe { SetMenuItemInfoW(menu as _, position, 1, &info) } == 0 {
            unsafe {
                reset_items(&*raw);
                RemoveWindowSubclass(hwnd, Some(owner_proc), OWNER_STYLE);
                drop(Box::from_raw(raw));
            }
            return Err("无法设置托盘菜单项目样式。".into());
        }
    }
    unsafe {
        background(&*raw);
    }
    Ok(())
}

unsafe fn reset_items(owner: &Owner) {
    for position in 0..4 {
        let info = MENUITEMINFOW {
            cbSize: size_of::<MENUITEMINFOW>() as _,
            fMask: MIIM_FTYPE | MIIM_DATA,
            fType: if position == 2 {
                MFT_SEPARATOR
            } else {
                MFT_STRING
            },
            dwItemData: 0,
            ..Default::default()
        };
        unsafe {
            SetMenuItemInfoW(owner.menu as _, position, 1, &info);
        }
    }
}

unsafe fn background(owner: &Owner) {
    let mut info = MENUINFO {
        cbSize: size_of::<MENUINFO>() as _,
        fMask: MIM_STYLE,
        ..Default::default()
    };
    unsafe {
        GetMenuInfo(owner.menu as _, &mut info);
        // Preserve the native dismissal and notification flags.
        info.fMask = MIM_BACKGROUND | MIM_STYLE;
        info.dwStyle |= MNS_NOCHECK;
        info.hbrBack = owner.frame.style.brush as _;
        SetMenuInfo(owner.menu as _, &info);
    }
}

unsafe extern "system" fn owner_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass: usize,
    data: usize,
) -> LRESULT {
    let raw = data as *mut Owner;
    match message {
        WM_INITMENUPOPUP if wparam == unsafe { (*raw).menu } => {
            if let Ok(frame) = Frame::new(unsafe { &(*raw).app }) {
                let previous = unsafe { std::mem::replace(&mut (*raw).frame, Arc::new(frame)) };
                unsafe {
                    background(&*raw);
                }
                drop(previous);
            }
        }
        WM_MEASUREITEM if lparam != 0 => {
            let measure = unsafe { &mut *(lparam as *mut MEASUREITEMSTRUCT) };
            if measure.CtlType == ODT_MENU
                && let Some(item) = unsafe { (*raw).item(measure.itemData) }
            {
                let frame = unsafe { (*raw).frame.clone() };
                // Windows adds its native side gutters around owner-drawn
                // content; together these make the card approximately 160px wide.
                measure.itemWidth = frame.style.px(142) as _;
                measure.itemHeight = frame.style.px(item.height()) as _;
                attach_popup(&frame);
                return 1;
            }
        }
        WM_DRAWITEM if lparam != 0 => {
            let draw = unsafe { &*(lparam as *const DRAWITEMSTRUCT) };
            if draw.CtlType == ODT_MENU
                && let Some(item) = unsafe { (*raw).item(draw.itemData) }
            {
                let frame = unsafe { (*raw).frame.clone() };
                attach_popup(&frame);
                paint_item(draw, item, &frame);
                return 1;
            }
        }
        WM_NCDESTROY => unsafe {
            RemoveWindowSubclass(hwnd, Some(owner_proc), subclass);
            let owner = Box::from_raw(raw);
            reset_items(&owner);
            let info = MENUINFO {
                cbSize: size_of::<MENUINFO>() as _,
                fMask: MIM_BACKGROUND,
                hbrBack: GetSysColorBrush(COLOR_MENU),
                ..Default::default()
            };
            SetMenuInfo(owner.menu as _, &info);
            drop(owner);
        },
        _ => {}
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

fn attach_popup(frame: &Arc<Frame>) {
    if frame.popup.load(Ordering::Relaxed) == 0 {
        // Search this UI thread only, while Windows is drawing our menu. No
        // Explorer windows or global input hooks are involved.
        unsafe {
            EnumThreadWindows(
                GetCurrentThreadId(),
                Some(find_popup),
                frame as *const Arc<Frame> as _,
            );
        }
    }
}

unsafe extern "system" fn find_popup(hwnd: HWND, data: LPARAM) -> i32 {
    let mut class = [0u16; 32];
    let count = unsafe { GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as _) };
    if count <= 0 || String::from_utf16_lossy(&class[..count as usize]) != "#32768" {
        return 1;
    }
    let frame = unsafe { &*(data as *const Arc<Frame>) };
    let mut previous = 0;
    if unsafe { GetWindowSubclass(hwnd, Some(popup_proc), POPUP_STYLE, &mut previous) } != 0 {
        let raw = previous as *mut Popup;
        let old_frame = unsafe { std::mem::replace(&mut (*raw).frame, frame.clone()) };
        old_frame.popup.store(0, Ordering::Relaxed);
        unsafe {
            (*raw).size = (0, 0);
        }
        frame.popup.store(hwnd as usize, Ordering::Relaxed);
        unsafe {
            round_popup(hwnd, raw);
        }
        return 0;
    }
    let popup = Box::new(Popup {
        frame: frame.clone(),
        size: (0, 0),
    });
    let raw = Box::into_raw(popup);
    if unsafe { SetWindowSubclass(hwnd, Some(popup_proc), POPUP_STYLE, raw as usize) } == 0 {
        unsafe {
            drop(Box::from_raw(raw));
        }
        return 1;
    }
    frame.popup.store(hwnd as usize, Ordering::Relaxed);
    unsafe {
        round_popup(hwnd, raw);
    }
    0
}

unsafe fn round_popup(hwnd: HWND, raw: *mut Popup) {
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return;
    }
    let size = (rect.right - rect.left, rect.bottom - rect.top);
    if size.0 <= 0 || size.1 <= 0 || size == unsafe { (*raw).size } {
        return;
    }
    unsafe {
        (*raw).size = size;
    }
    let frame = unsafe { (*raw).frame.clone() };
    let corner = DWMWCP_ROUND;
    let border = rgb(frame.style.colors.border);
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE as _,
            &corner as *const _ as _,
            size_of::<i32>() as _,
        );
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR as _,
            &border as *const _ as _,
            size_of::<u32>() as _,
        );
        let radius = frame.style.px(18);
        let region = CreateRoundRectRgn(0, 0, size.0 + 1, size.1 + 1, radius, radius);
        if !region.is_null() && SetWindowRgn(hwnd, region, 1) == 0 {
            DeleteObject(region);
        }
    }
}

unsafe extern "system" fn popup_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass: usize,
    data: usize,
) -> LRESULT {
    let raw = data as *mut Popup;
    match message {
        WM_WINDOWPOSCHANGED => {
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            let mut current = 0;
            if unsafe { GetWindowSubclass(hwnd, Some(popup_proc), subclass, &mut current) } != 0
                && current == data
            {
                unsafe {
                    round_popup(hwnd, raw);
                }
            }
            return result;
        }
        WM_NCPAINT => {
            let frame = unsafe { (*raw).frame.clone() };
            let hdc = unsafe { GetWindowDC(hwnd) };
            if !hdc.is_null() {
                let (width, height) = unsafe { (*raw).size };
                let pen = unsafe { CreatePen(PS_SOLID, 1, rgb(frame.style.colors.border)) };
                let saved = unsafe { SaveDC(hdc) };
                unsafe {
                    SelectObject(hdc, pen);
                    SelectObject(hdc, GetStockObject(NULL_BRUSH));
                    RoundRect(
                        hdc,
                        0,
                        0,
                        width,
                        height,
                        frame.style.px(18),
                        frame.style.px(18),
                    );
                    RestoreDC(hdc, saved);
                    DeleteObject(pen);
                    ReleaseDC(hwnd, hdc);
                }
            }
            return 0;
        }
        WM_TIMER if wparam == HOVER_TIMER => {
            let frame = unsafe { (*raw).frame.clone() };
            let (fading, regions) = frame
                .hover
                .lock()
                .map(|hover| {
                    (
                        hover.progress(Instant::now(), frame.style.animate) < 1.0,
                        hover.repaint_regions(),
                    )
                })
                .unwrap_or((false, [None; 4]));
            unsafe {
                for rect in regions.into_iter().flatten() {
                    InvalidateRect(hwnd, &rect, 0);
                }
                if !fading {
                    KillTimer(hwnd, HOVER_TIMER);
                }
            }
            return 0;
        }
        WM_NCDESTROY => unsafe {
            KillTimer(hwnd, HOVER_TIMER);
            RemoveWindowSubclass(hwnd, Some(popup_proc), subclass);
            let popup = Box::from_raw(raw);
            popup.frame.popup.store(0, Ordering::Relaxed);
            drop(popup);
        },
        _ => {}
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

struct PaintBuffer {
    hdc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    width: i32,
    height: i32,
}

impl PaintBuffer {
    fn new(target: HDC, width: i32, height: i32) -> Option<Self> {
        if width <= 0 || height <= 0 {
            return None;
        }
        unsafe {
            let hdc = CreateCompatibleDC(target);
            if hdc.is_null() {
                return None;
            }
            // Use the target DC so the bitmap keeps its color format instead
            // of inheriting the memory DC's initial monochrome bitmap.
            let bitmap = CreateCompatibleBitmap(target, width, height);
            if bitmap.is_null() {
                DeleteDC(hdc);
                return None;
            }
            let previous = SelectObject(hdc, bitmap);
            if previous.is_null() || previous as isize == -1 {
                DeleteObject(bitmap);
                DeleteDC(hdc);
                return None;
            }
            Some(Self {
                hdc,
                bitmap,
                previous,
                width,
                height,
            })
        }
    }

    fn present(&self, target: HDC, x: i32, y: i32) -> bool {
        unsafe {
            BitBlt(
                target,
                x,
                y,
                self.width,
                self.height,
                self.hdc,
                0,
                0,
                SRCCOPY,
            ) != 0
        }
    }
}

impl Drop for PaintBuffer {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.hdc, self.previous);
            DeleteObject(self.bitmap);
            DeleteDC(self.hdc);
        }
    }
}

fn paint_item(draw: &DRAWITEMSTRUCT, item: Item, frame: &Frame) {
    if let Ok(mut hover) = frame.hover.lock() {
        hover.bounds[item.index()] = Some(draw.rcItem);
    }
    let width = draw.rcItem.right - draw.rcItem.left;
    let height = draw.rcItem.bottom - draw.rcItem.top;
    if let Some(buffer) = PaintBuffer::new(draw.hDC, width, height) {
        let buffered = DRAWITEMSTRUCT {
            hDC: buffer.hdc,
            rcItem: RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            },
            ..*draw
        };
        // Clearing and repainting text directly on the menu exposes a blank
        // frame during hover fades. Present only the completed row.
        paint_item_contents(&buffered, item, frame);
        if buffer.present(draw.hDC, draw.rcItem.left, draw.rcItem.top) {
            return;
        }
    }
    paint_item_contents(draw, item, frame);
}

fn paint_item_contents(draw: &DRAWITEMSTRUCT, item: Item, frame: &Frame) {
    let style = &frame.style;
    let hdc = draw.hDC;
    let saved = unsafe { SaveDC(hdc) };
    unsafe {
        FillRect(hdc, &draw.rcItem, style.brush as _);
    }
    if matches!(item, Item::Divider) {
        let y = (draw.rcItem.top + draw.rcItem.bottom) / 2;
        let rect = RECT {
            left: draw.rcItem.left + style.px(10),
            right: draw.rcItem.right - style.px(10),
            top: y,
            bottom: y + 1,
        };
        let brush = unsafe { CreateSolidBrush(rgb(style.colors.border)) };
        unsafe {
            FillRect(hdc, &rect, brush);
            DeleteObject(brush);
            RestoreDC(hdc, saved);
        }
        return;
    }
    let mut button = draw.rcItem;
    button.left += style.px(4);
    button.right -= style.px(4);
    if matches!(item, Item::Show) {
        button.top += style.px(4);
    }
    if matches!(item, Item::Quit) {
        button.bottom -= style.px(4);
    }
    let selected = draw.itemState & ODS_SELECTED != 0;
    let (amount, fading) = frame
        .hover
        .lock()
        .map(|mut hover| hover.sample(item, selected, Instant::now(), style.animate))
        .unwrap_or((selected as u8 as f32, false));
    if fading {
        let popup = frame.popup.load(Ordering::Relaxed);
        if popup != 0 {
            unsafe {
                SetTimer(popup as _, HOVER_TIMER, 16, None);
            }
        }
    }
    let hover = if matches!(item, Item::Quit) {
        style.colors.danger_hover
    } else {
        style.colors.hover
    };
    let background = mix(style.colors.background, hover, amount);
    let brush = unsafe { CreateSolidBrush(rgb(background)) };
    unsafe {
        SelectObject(hdc, brush);
        SelectObject(hdc, GetStockObject(NULL_PEN));
        RoundRect(
            hdc,
            button.left,
            button.top,
            button.right,
            button.bottom,
            style.px(10),
            style.px(10),
        );
    }
    let (index, label) = match item {
        Item::Show => (0, "界面"),
        Item::Restart => (1, "重启"),
        Item::Quit => (2, "退出"),
        Item::Divider => unreachable!(),
    };
    let image = &style.icons[index];
    let left = button.left + style.px(8);
    let top = (button.top + button.bottom - image.height() as i32) / 2;
    paint_icon(hdc, image, left, top, background);
    let text: Vec<u16> = label.encode_utf16().collect();
    let mut rect = RECT {
        left: left + image.width() as i32 + style.px(10),
        ..button
    };
    let foreground = if matches!(item, Item::Quit) {
        style.colors.danger
    } else {
        style.colors.foreground
    };
    unsafe {
        SelectObject(hdc, style.font as _);
        SetBkMode(hdc, TRANSPARENT as _);
        SetTextColor(hdc, rgb(foreground));
        DrawTextW(
            hdc,
            text.as_ptr(),
            text.len() as _,
            &mut rect,
            DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX,
        );
        RestoreDC(hdc, saved);
        DeleteObject(brush);
    }
}

fn paint_icon(hdc: HDC, image: &Image<'_>, x: i32, y: i32, background: [u8; 3]) {
    let mut pixels = Vec::with_capacity(image.rgba().len());
    for pixel in image.rgba().as_chunks::<4>().0 {
        let alpha = pixel[3] as u32;
        for channel in [2, 1, 0] {
            pixels.push(
                ((pixel[channel] as u32 * alpha + background[channel] as u32 * (255 - alpha) + 127)
                    / 255) as u8,
            );
        }
        pixels.push(255);
    }
    let width = image.width() as i32;
    let height = image.height() as i32;
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as _,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..Default::default()
        },
        ..Default::default()
    };
    unsafe {
        StretchDIBits(
            hdc,
            x,
            y,
            width,
            height,
            0,
            0,
            width,
            height,
            pixels.as_ptr() as *const c_void,
            &info,
            DIB_RGB_COLORS,
            SRCCOPY,
        );
    }
}

fn rgb(color: [u8; 3]) -> u32 {
    color[0] as u32 | ((color[1] as u32) << 8) | ((color[2] as u32) << 16)
}
fn mix(from: [u8; 3], to: [u8; 3], amount: f32) -> [u8; 3] {
    std::array::from_fn(|index| {
        (from[index] as f32 + (to[index] as f32 - from[index] as f32) * amount).round() as u8
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hover_repaints_only_the_incoming_and_outgoing_rows() {
        let mut hover = Hover::new();
        hover.bounds = std::array::from_fn(|index| {
            Some(RECT {
                top: index as i32 * 40,
                bottom: (index as i32 + 1) * 40,
                left: 0,
                right: 184,
            })
        });
        let start = Instant::now();
        hover.sample(Item::Show, true, start, true);
        let regions = hover.repaint_regions();
        assert!(regions[Item::Show.index()].is_some());
        assert!(regions[Item::Restart.index()].is_none());
        assert!(regions[Item::Divider.index()].is_none());
        assert!(regions[Item::Quit.index()].is_none());

        hover.sample(Item::Show, false, start + FADE, true);
        hover.sample(Item::Restart, true, start + FADE, true);
        let regions = hover.repaint_regions();
        assert!(regions[Item::Show.index()].is_some());
        assert!(regions[Item::Restart.index()].is_some());
        assert!(regions[Item::Divider.index()].is_none());
        assert!(regions[Item::Quit.index()].is_none());
    }

    #[test]
    fn partial_hover_frames_do_not_erase_visible_text() {
        let screen = unsafe { GetDC(std::ptr::null_mut()) };
        assert!(!screen.is_null());
        let target = PaintBuffer::new(screen, 12, 12);
        let frame = PaintBuffer::new(screen, 4, 4);
        unsafe {
            ReleaseDC(std::ptr::null_mut(), screen);
        }
        let target = target.expect("create destination surface");
        let frame = frame.expect("create hover frame");
        let before = rgb([255; 3]);
        let after = rgb([245; 3]);
        let ink = rgb([10; 3]);
        let target_bounds = RECT {
            left: 0,
            top: 0,
            right: 12,
            bottom: 12,
        };
        let frame_bounds = RECT {
            right: 4,
            bottom: 4,
            ..target_bounds
        };
        unsafe {
            let brush = GetStockObject(DC_BRUSH);
            SetDCBrushColor(target.hdc, before);
            FillRect(target.hdc, &target_bounds, brush);
            SetPixel(target.hdc, 4, 6, ink);

            SetDCBrushColor(frame.hdc, after);
            FillRect(frame.hdc, &frame_bounds, brush);
            // The unfinished background pass must leave the old text intact.
            assert_eq!(GetPixel(target.hdc, 4, 6), ink);
            assert_eq!(GetPixel(target.hdc, 3, 5), before);
            SetPixel(frame.hdc, 1, 1, ink);
            assert!(frame.present(target.hdc, 3, 5));
            assert_eq!(GetPixel(target.hdc, 4, 6), ink);
            assert_eq!(GetPixel(target.hdc, 3, 5), after);
            assert_eq!(GetPixel(target.hdc, 0, 0), before);
        }
    }

    #[test]
    fn hover_switches_continue_from_the_current_color() {
        let mut hover = Hover::new();
        let start = Instant::now();
        assert_eq!(hover.sample(Item::Show, true, start, true).0, 0.0);
        let midway = start + Duration::from_millis(50);
        assert!((hover.sample(Item::Show, true, midway, true).0 - 0.5).abs() < 0.01);
        assert!((hover.sample(Item::Show, false, midway, true).0 - 0.5).abs() < 0.01);
        assert!(
            (hover
                .sample(Item::Show, false, midway + Duration::from_millis(50), true)
                .0
                - 0.25)
                .abs()
                < 0.01
        );
        assert_eq!(hover.sample(Item::Show, false, midway + FADE, true).0, 0.0);
    }
    #[test]
    fn reduced_motion_changes_highlight_immediately() {
        let mut hover = Hover::new();
        assert_eq!(
            hover.sample(Item::Quit, true, Instant::now(), false),
            (1.0, false)
        );
        assert_eq!(
            hover.sample(Item::Quit, false, Instant::now(), false),
            (0.0, false)
        );
    }
    #[test]
    fn menu_palette_matches_the_app_theme() {
        assert_eq!(Colors::new(false).background, [255; 3]);
        assert_eq!(Colors::new(true).background, [23; 3]);
        assert_eq!(mix([255; 3], [240; 3], 0.0), [255; 3]);
        assert_eq!(mix([255; 3], [240; 3], 1.0), [240; 3]);
    }
}
