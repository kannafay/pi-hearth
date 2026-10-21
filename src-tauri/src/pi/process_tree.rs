#[cfg(windows)]
pub struct ProcessTree(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for ProcessTree {}

#[cfg(windows)]
impl ProcessTree {
    pub fn attach(pid: u32) -> Result<Self, String> {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::{JobObjects::*, Threading::*},
        };
        // All handles are created by this application; the job is never inherited.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("无法创建 Pi 进程管理容器。".into());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
            {
                CloseHandle(job);
                return Err("无法配置 Pi 进程回收。".into());
            }
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                CloseHandle(job);
                return Err("无法管理 Pi 子进程。".into());
            }
            let attached = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if attached == 0 {
                CloseHandle(job);
                return Err("无法将 Pi 加入进程管理容器。".into());
            }
            Ok(Self(job))
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(unix)]
pub struct ProcessTree(u32);

#[cfg(unix)]
impl ProcessTree {
    pub fn attach(pid: u32) -> Result<Self, String> {
        Ok(Self(pid))
    }
}

#[cfg(unix)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            libc::kill(-(self.0 as i32), libc::SIGKILL);
        }
    }
}
