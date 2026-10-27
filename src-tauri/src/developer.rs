use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

static ENABLED: AtomicBool = AtomicBool::new(false);
static MODE: Mutex<Mode> = Mutex::new(Mode {
    log: None,
    terminal: None,
});
pub static SETTINGS_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct Log {
    file: File,
    started: Instant,
}

impl Log {
    fn write(&mut self, label: &str, detail: &str) {
        let elapsed = self.started.elapsed();
        let seconds = elapsed.as_secs();
        let detail: String = detail
            .chars()
            .filter(|c| !c.is_control())
            .take(1500)
            .collect();
        let _ = writeln!(
            self.file,
            "[{:02}:{:02}:{:02}.{:03}] {label} | {detail}",
            seconds / 3600,
            seconds / 60 % 60,
            seconds % 60,
            elapsed.subsec_millis()
        );
        let _ = self.file.flush();
    }
}

struct Mode {
    log: Option<Log>,
    terminal: Option<Terminal>,
}

pub fn set_enabled(data: &Path, enabled: bool) -> Result<(), String> {
    let mut mode = MODE.lock().map_err(|_| "开发者模式状态不可用。")?;
    if !enabled {
        ENABLED.store(false, Ordering::Relaxed);
        if let Some(log) = mode.log.as_mut() {
            log.write("开发者模式", "已关闭");
        }
        mode.terminal = None;
        mode.log = None;
        return Ok(());
    }
    if mode.terminal.as_ref().is_some_and(Terminal::is_running) {
        return Ok(());
    }
    let path = data.join("logs").join("developer.log");
    std::fs::create_dir_all(path.parent().unwrap())
        .map_err(|e| format!("无法创建日志目录：{e}"))?;
    let mut log = if let Some(log) = mode.log.take() {
        log
    } else {
        let truncate = path.metadata().is_ok_and(|m| m.len() > 2 * 1024 * 1024);
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(!truncate)
            .truncate(truncate)
            .open(&path)
            .map_err(|e| format!("无法打开后台日志：{e}"))?;
        Log {
            file,
            started: Instant::now(),
        }
    };
    log.write(
        "Pi Hearth 后台日志",
        "时间为开启后的经过时间；关闭终端不会退出主应用。",
    );
    match Terminal::open(&path) {
        Ok(terminal) => {
            mode.terminal = Some(terminal);
            mode.log = Some(log);
            ENABLED.store(true, Ordering::Relaxed);
            Ok(())
        }
        Err(error) => {
            mode.log = Some(log);
            Err(error)
        }
    }
}

pub fn record(label: &str, detail: impl FnOnce() -> String) {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let detail = detail();
    if let Ok(mut mode) = MODE.lock()
        && let Some(log) = mode.log.as_mut()
    {
        log.write(label, &detail);
    }
}

pub struct Operation {
    label: String,
    started: Instant,
    finished: bool,
}

impl Operation {
    pub fn start(label: &str, detail: impl FnOnce() -> String) -> Self {
        let enabled = ENABLED.load(Ordering::Relaxed);
        if enabled {
            record(label, || format!("开始 {}", detail()));
        }
        Self {
            label: if enabled { label.into() } else { String::new() },
            started: Instant::now(),
            finished: false,
        }
    }

    pub fn finish<T>(mut self, result: &Result<T, String>) {
        self.finished = true;
        if self.label.is_empty() {
            return;
        }
        record(&self.label, || match result {
            Ok(_) => format!("完成，耗时 {} ms", self.started.elapsed().as_millis()),
            Err(error) => format!(
                "失败，耗时 {} ms：{error}",
                self.started.elapsed().as_millis()
            ),
        });
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        if !self.finished && !self.label.is_empty() {
            record(&self.label, || {
                format!("已取消，耗时 {} ms", self.started.elapsed().as_millis())
            });
        }
    }
}

#[cfg(windows)]
struct Terminal {
    process: std::os::windows::io::OwnedHandle,
    _tree: crate::pi::process_tree::ProcessTree,
}

#[cfg(windows)]
impl Terminal {
    fn open(log: &Path) -> Result<Self, String> {
        use base64::{Engine, engine::general_purpose::STANDARD};
        use std::os::windows::{ffi::OsStrExt, io::FromRawHandle};
        use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::*};

        let system = std::env::var_os("SystemRoot").ok_or("无法定位 Windows PowerShell。")?;
        let executable = Path::new(&system).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let script = format!(
            "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); $Host.UI.RawUI.WindowTitle = 'Pi Hearth 后台日志'; Get-Content -LiteralPath '{}' -Encoding UTF8 -Tail 120 -Wait",
            log.to_string_lossy().replace('\'', "''")
        );
        let encoded = STANDARD.encode(
            script
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>(),
        );
        let mut command: Vec<u16> = format!(
            "\"{}\" -NoLogo -NoProfile -EncodedCommand {encoded}",
            executable.display()
        )
        .encode_utf16()
        .chain(Some(0))
        .collect();
        let executable: Vec<u16> = executable
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        // A separate console process keeps its close button independent of the app.
        // No inherited stdio: Windows supplies handles belonging to the new console.
        unsafe {
            let mut startup: STARTUPINFOW = std::mem::zeroed();
            startup.cb = std::mem::size_of_val(&startup) as u32;
            let mut info: PROCESS_INFORMATION = std::mem::zeroed();
            if CreateProcessW(
                executable.as_ptr(),
                command.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                CREATE_NEW_CONSOLE,
                std::ptr::null(),
                std::ptr::null(),
                &startup,
                &mut info,
            ) == 0
            {
                return Err(format!(
                    "无法打开后台终端：{}",
                    std::io::Error::last_os_error()
                ));
            }
            CloseHandle(info.hThread);
            let process = std::os::windows::io::OwnedHandle::from_raw_handle(info.hProcess);
            match crate::pi::process_tree::ProcessTree::attach(info.dwProcessId) {
                Ok(tree) => Ok(Self {
                    process,
                    _tree: tree,
                }),
                Err(error) => {
                    TerminateProcess(info.hProcess, 0);
                    Err(error)
                }
            }
        }
    }

    fn is_running(&self) -> bool {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            windows_sys::Win32::System::Threading::WaitForSingleObject(
                self.process.as_raw_handle(),
                0,
            ) == windows_sys::Win32::Foundation::WAIT_TIMEOUT
        }
    }
}

#[cfg(windows)]
impl Drop for Terminal {
    fn drop(&mut self) {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            windows_sys::Win32::System::Threading::TerminateProcess(
                self.process.as_raw_handle(),
                0,
            );
        }
    }
}

#[cfg(not(windows))]
struct Terminal;

#[cfg(not(windows))]
impl Terminal {
    fn open(_log: &Path) -> Result<Self, String> {
        Err("独立后台终端目前仅支持 Windows。".into())
    }
    fn is_running(&self) -> bool {
        false
    }
}

#[tauri::command]
pub async fn developer_console_open(app: tauri::AppHandle) -> Result<(), String> {
    let _gate = SETTINGS_GATE.lock().await;
    let data = crate::app_data::directory(&app)?;
    if !crate::pi::storage::settings(&data).await?.developer_mode {
        return Err("请先开启开发者模式。".into());
    }
    set_enabled(&data, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_lines_are_bounded_and_do_not_allow_terminal_control_sequences() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/developer-log-test")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("developer.log");
        let mut log = Log {
            file: File::create(&path).unwrap(),
            started: Instant::now(),
        };
        log.write("test", &format!("first\nsecond\r\x1b{}", "x".repeat(2000)));
        drop(log);
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 1);
        assert!(!text.contains('\x1b'));
        assert!(text.contains("firstsecond"));
        assert!(text.len() < 1600);
    }
}
