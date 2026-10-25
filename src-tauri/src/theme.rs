use std::{
    ffi::c_void,
    mem::size_of,
    ptr::null_mut,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, Manager};
use windows_sys::Win32::{
    Foundation::{
        ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS, HWND, LPARAM, LRESULT, WPARAM,
    },
    Graphics::Dwm::{
        DWMSBT_NONE, DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_TRANSITIONS_FORCEDISABLED,
        DwmGetWindowAttribute, DwmSetWindowAttribute,
    },
    System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW},
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{WM_NCDESTROY, WM_SETTINGCHANGE},
    },
};

const SYSTEM_THEME_LISTENER: usize = 0x50494810;

mod presentation;
pub use presentation::{Presentation, on_window_event};

#[tauri::command]
pub fn finish_window_theme_change(window: tauri::WebviewWindow, transition_id: String) {
    presentation::finish(&window, Some(&transition_id));
}

pub fn set_window_theme(
    window: tauri::WebviewWindow,
    theme: Option<tauri::Theme>,
    transition_id: Option<&str>,
) -> Result<(), String> {
    if let Some(request) = transition_id {
        presentation::begin(&window, request);
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    let set_attribute = |attribute: i32, value: i32| unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attribute as u32,
            &value as *const i32 as *const c_void,
            size_of::<i32>() as u32,
        )
    };
    let disabled = set_attribute(DWMWA_TRANSITIONS_FORCEDISABLED, 1) >= 0;
    let mut backdrop = DWMSBT_NONE;
    let has_backdrop = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE as u32,
            &mut backdrop as *mut i32 as *mut c_void,
            size_of::<i32>() as u32,
        )
    } >= 0
        && backdrop > DWMSBT_NONE;
    // Recreate the existing material in its final color instead of crossfading it.
    let detached = has_backdrop && set_attribute(DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_NONE) >= 0;
    let result = window.set_theme(theme).map_err(|error| error.to_string());
    if detached {
        set_attribute(DWMWA_SYSTEMBACKDROP_TYPE, backdrop);
    }
    if disabled {
        set_attribute(DWMWA_TRANSITIONS_FORCEDISABLED, 0);
    }
    if result.is_err() {
        presentation::finish(&window, transition_id);
    }
    result
}

// Read the OS preference rather than the WebView2 profile's forced color scheme.
#[tauri::command]
pub fn get_system_theme() -> Result<bool, String> {
    let key: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\0"
        .encode_utf16()
        .collect();
    let name: Vec<u16> = "AppsUseLightTheme\0".encode_utf16().collect();
    let mut light = 1_u32;
    let mut size = size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            null_mut(),
            &mut light as *mut u32 as *mut c_void,
            &mut size,
        )
    };
    match status {
        ERROR_SUCCESS => Ok(light == 0),
        ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(false),
        _ => Err(format!("无法读取 Windows 系统主题（{status}）。")),
    }
}

struct SystemThemeListener {
    app: AppHandle,
    dark: AtomicBool,
}

pub fn install(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("主窗口不存在。")?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    let raw = Box::into_raw(Box::new(SystemThemeListener {
        app: app.clone(),
        dark: AtomicBool::new(get_system_theme()?),
    }));
    if unsafe {
        SetWindowSubclass(
            hwnd,
            Some(system_theme_proc),
            SYSTEM_THEME_LISTENER,
            raw as usize,
        )
    } == 0
    {
        unsafe { drop(Box::from_raw(raw)) };
        return Err("无法监听 Windows 系统主题。".into());
    }
    Ok(())
}

unsafe extern "system" fn system_theme_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    data: usize,
) -> LRESULT {
    if message == WM_SETTINGCHANGE {
        let listener = unsafe { &*(data as *const SystemThemeListener) };
        if let Ok(dark) = get_system_theme()
            && listener.dark.swap(dark, Ordering::Relaxed) != dark
        {
            let _ = listener.app.emit("system-theme-changed", dark);
        }
    } else if message == WM_NCDESTROY {
        unsafe {
            RemoveWindowSubclass(hwnd, Some(system_theme_proc), id);
            drop(Box::from_raw(data as *mut SystemThemeListener));
        }
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}
