use super::catalog;
use std::path::Path;
use tauri::Url;

fn vscode_url(directory: &Path) -> Result<String, String> {
    let file = Url::from_file_path(directory).map_err(|_| "无法生成 VS Code 目录链接。")?;
    let host = file
        .host_str()
        .map(|host| format!("//{host}"))
        .unwrap_or_default();
    Ok(format!("vscode://file{host}{}", file.path()))
}

#[tauri::command]
pub fn workspace_open_with(path: String, application: String) -> Result<(), String> {
    let directory = dunce::canonicalize(path).map_err(|_| "会话目录不存在或无法访问。")?;
    if !directory.is_dir() {
        return Err("打开方式需要指定文件夹。".into());
    }
    match application.as_str() {
        "explorer" => catalog::open_path(&directory),
        "vscode" => catalog::open_path(Path::new(&vscode_url(&directory)?))
            .map_err(|_| "无法打开 VS Code，请确认已安装 VS Code。".into()),
        "terminal" => open_terminal(&directory),
        _ => Err("不支持的打开方式。".into()),
    }
}

#[cfg(windows)]
fn open_terminal(directory: &Path) -> Result<(), String> {
    let executable = std::env::var_os("LOCALAPPDATA")
        .map(|path| Path::new(&path).join("Microsoft/WindowsApps/wt.exe"))
        .filter(|path| path.is_file())
        .or_else(|| {
            let path = std::env::var_os("PATH")?;
            std::env::split_paths(&path)
                .filter(|directory| directory.is_absolute())
                .map(|directory| directory.join("wt.exe"))
                .find(|path| path.is_file())
        })
        .ok_or("无法打开 Windows 终端，请确认已安装 Windows Terminal。")?;
    std::process::Command::new(executable)
        .args(["--window", "new"])
        .arg("--startingDirectory")
        .arg(directory)
        .current_dir(directory)
        .spawn()
        .map(|_| ())
        .map_err(|_| "无法打开 Windows 终端，请确认已安装 Windows Terminal。".into())
}

#[cfg(not(windows))]
fn open_terminal(_directory: &Path) -> Result<(), String> {
    Err("Windows 终端打开方式仅适用于 Windows。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vscode_links_preserve_unicode_spaces_and_literal_url_characters() {
        let directory = if cfg!(windows) {
            Path::new(r"C:\项目 folder #1 %2F")
        } else {
            Path::new("/tmp/项目 folder #1 %2F")
        };
        let url = Url::parse(&vscode_url(directory).unwrap()).unwrap();
        assert_eq!(url.scheme(), "vscode");
        assert_eq!(url.host_str(), Some("file"));
        let decoded = percent_encoding::percent_decode_str(url.path())
            .decode_utf8()
            .unwrap();
        assert!(decoded.ends_with("/项目 folder #1 %2F"));
        assert!(url.query().is_none());
        assert!(url.fragment().is_none());
    }

    #[test]
    fn missing_or_file_targets_do_not_launch_an_application() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR"));
        assert!(
            workspace_open_with(
                directory.join("Cargo.toml").to_string_lossy().into(),
                "explorer".into()
            )
            .is_err()
        );
        assert!(
            workspace_open_with(
                directory
                    .join("missing-open-with-target")
                    .to_string_lossy()
                    .into(),
                "vscode".into()
            )
            .is_err()
        );
        assert!(
            workspace_open_with(directory.to_string_lossy().into(), "unsupported".into()).is_err()
        );
    }
}
