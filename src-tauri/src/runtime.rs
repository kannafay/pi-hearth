use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(crate) struct RuntimePaths {
    pub node: PathBuf,
    pub pi: PathBuf,
    pub directory: Option<PathBuf>,
}

impl RuntimePaths {
    fn resolve(executable: &Path, development: bool) -> Result<Self, String> {
        if development {
            return Ok(Self {
                node: PathBuf::from("node"),
                pi: Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../node_modules/@earendil-works/pi-coding-agent"),
                directory: None,
            });
        }
        let directory = executable
            .parent()
            .ok_or("无法定位应用安装目录。")?
            .join("runtime");
        let node = directory.join("node/node.exe");
        let pi = directory.join("pi/node_modules/@earendil-works/pi-coding-agent");
        for file in [
            node.clone(),
            directory.join("manifest.json"),
            pi.join("package.json"),
            pi.join("dist/bundle/cli.js"),
            pi.join("dist/core/session-manager.js"),
            pi.join("dist/core/http-dispatcher.js"),
            directory.join("pi/runtime-smoke.mjs"),
        ] {
            if !file.is_file() {
                return Err(format!(
                    "应用运行时资源缺失，请重新安装 Pi Hearth。缺少：{}",
                    file.display()
                ));
            }
        }
        Ok(Self {
            node,
            pi,
            directory: Some(directory),
        })
    }

    fn apply(&self, command: &mut std::process::Command) -> Result<(), String> {
        if self.directory.is_some() {
            let mut paths = vec![
                self.node
                    .parent()
                    .ok_or("无效的 Node.js 安装目录。")?
                    .to_owned(),
            ];
            paths.extend(std::env::split_paths(
                &std::env::var_os("PATH").unwrap_or_default(),
            ));
            command.env(
                "PATH",
                std::env::join_paths(paths).map_err(|_| "无法准备运行时 PATH。")?,
            );
            command.env_remove("NODE_PATH").env_remove("NODE_OPTIONS");
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        Ok(())
    }
}

pub(crate) fn paths() -> Result<RuntimePaths, String> {
    RuntimePaths::resolve(
        &std::env::current_exe().map_err(|_| "无法定位应用程序。")?,
        tauri::is_dev(),
    )
}

pub(crate) fn pi_file(relative: &str) -> Result<PathBuf, String> {
    let file = paths()?.pi.join(relative);
    dunce::canonicalize(&file).map_err(|_| {
        if tauri::is_dev() {
            "缺少项目 Pi 运行时，请先运行 pnpm install。".into()
        } else {
            "应用 Pi 运行时资源缺失，请重新安装 Pi Hearth。".into()
        }
    })
}

pub(crate) fn command_sync() -> Result<std::process::Command, String> {
    let runtime = paths()?;
    let mut command = std::process::Command::new(&runtime.node);
    runtime.apply(&mut command)?;
    Ok(command)
}

pub(crate) fn command() -> Result<tokio::process::Command, String> {
    Ok(tokio::process::Command::from(command_sync()?))
}

pub(crate) fn validate() -> Result<(), String> {
    let runtime = paths()?;
    let Some(directory) = runtime.directory else {
        return Ok(());
    };
    let json = |file: &Path| -> Result<serde_json::Value, String> {
        serde_json::from_slice(
            &std::fs::read(file).map_err(|_| "无法读取运行时清单，请重新安装。")?,
        )
        .map_err(|_| "运行时清单损坏，请重新安装。".into())
    };
    let manifest = json(&directory.join("manifest.json"))?;
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("../../runtime/windows-runtime.json")).unwrap();
    let package: serde_json::Value =
        serde_json::from_str(include_str!("../../runtime/package.json")).unwrap();
    let pi = json(&runtime.pi.join("package.json"))?;
    if manifest["schemaVersion"] != 1
        || manifest["target"] != expected["target"]
        || manifest["nodeVersion"] != expected["nodeVersion"]
        || manifest["piVersion"] != package["dependencies"]["@earendil-works/pi-coding-agent"]
        || pi["version"] != manifest["piVersion"]
    {
        return Err("应用与运行时版本不一致，请重新安装完整的 Pi Hearth 安装包。".into());
    }
    let result = command_sync()?
        .arg("--version")
        .output()
        .map_err(|_| "随附 Node.js 无法启动，请重新安装 Pi Hearth。")?;
    let expected_node = format!("v{}", expected["nodeVersion"].as_str().unwrap());
    if !result.status.success() || String::from_utf8_lossy(&result.stdout).trim() != expected_node {
        return Err("随附 Node.js 版本异常，请重新安装 Pi Hearth。".into());
    }
    Ok(())
}

pub fn installation_check(report: &Path) -> Result<(), String> {
    let result = (|| {
        validate()?;
        let runtime = paths()?;
        let directory = runtime.directory.ok_or("安装检查需要使用打包后的应用。")?;
        let output = command_sync()?
            .arg(directory.join("pi/runtime-smoke.mjs"))
            .output()
            .map_err(|_| "无法启动安装检查。")?;
        if !output.status.success() {
            return Err(format!(
                "运行时检查失败：{}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        serde_json::from_slice::<serde_json::Value>(&output.stdout)
            .map_err(|_| "安装检查返回了无效数据。".into())
    })();
    let value = match &result {
        Ok(value) => value.clone(),
        Err(error) => serde_json::json!({"success":false,"error":error}),
    };
    std::fs::write(report, serde_json::to_vec_pretty(&value).unwrap())
        .map_err(|_| "无法写入安装检查报告。")?;
    result.map(|_| ())
}

#[cfg(windows)]
pub(crate) fn show_error(message: &str) {
    let title: Vec<u16> = "Pi Hearth 启动失败\0".encode_utf16().collect();
    let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            0x10,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_does_not_fall_back_to_development_files() {
        let root =
            std::env::temp_dir().join(format!("hearth-运行时 空格-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("Pi Hearth.exe");
        assert!(
            RuntimePaths::resolve(&executable, false)
                .unwrap_err()
                .contains("重新安装")
        );
        let dev = RuntimePaths::resolve(&executable, true).unwrap();
        assert_eq!(dev.node, Path::new("node"));
        assert!(dev.directory.is_none());
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn installed_paths_are_relative_to_the_executable_and_support_unicode() {
        let root = std::env::temp_dir().join(format!("hearth-安装 空格-{}", uuid::Uuid::new_v4()));
        let relative = [
            "node/node.exe",
            "manifest.json",
            "pi/runtime-smoke.mjs",
            "pi/node_modules/@earendil-works/pi-coding-agent/package.json",
            "pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
            "pi/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js",
            "pi/node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js",
        ];
        for file in relative {
            let file = root.join("runtime").join(file);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, "").unwrap();
        }
        let runtime = RuntimePaths::resolve(&root.join("Pi Hearth.exe"), false).unwrap();
        assert!(runtime.node.starts_with(&root));
        let mut command = std::process::Command::new(&runtime.node);
        runtime.apply(&mut command).unwrap();
        let value = command
            .get_envs()
            .find(|(name, _)| *name == "PATH")
            .unwrap()
            .1
            .unwrap();
        assert_eq!(
            std::env::split_paths(value).next().unwrap(),
            root.join("runtime/node")
        );
        assert!(
            command
                .get_envs()
                .any(|(name, value)| name == "NODE_OPTIONS" && value.is_none())
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
