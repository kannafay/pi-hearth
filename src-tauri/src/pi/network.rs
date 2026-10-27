use super::{
    config::local_agent_directory,
    storage,
    types::{ProxyMode, ProxySettings, ProxyTestResult},
};
use base64::Engine;
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path, process::Stdio, time::Duration};
use tauri::{Manager, Url};
use tokio::{io::AsyncWriteExt, process::Command, sync::Mutex, time::timeout};

const PROXY_KEYS: [&str; 6] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
];

pub(super) struct ProxyEnvironment {
    pub values: HashMap<String, String>,
    pub secrets: Vec<String>,
}

fn proxy_url(value: &str) -> Result<Url, String> {
    let value = value.trim();
    if value.len() > 4096 || value.chars().any(char::is_whitespace) {
        return Err("代理地址过长或包含空白字符。".into());
    }
    let mut url =
        Url::parse(value).map_err(|_| "请输入完整的代理地址，例如 http://127.0.0.1:7890。")?;
    if matches!(url.scheme(), "socks" | "socks5h") {
        let _ = url.set_scheme("socks5");
    }
    if !matches!(url.scheme(), "http" | "https" | "socks5")
        || url.host_str().is_none()
        || url.port() == Some(0)
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "代理地址需使用 HTTP、HTTPS 或 SOCKS5，且不能包含路径、查询参数或片段。".into(),
        );
    }
    Ok(url)
}

pub(super) fn validate(proxy: &ProxySettings) -> Result<(), String> {
    if proxy.no_proxy.len() > 4096 || proxy.no_proxy.contains('\0') || proxy.url.len() > 4096 {
        return Err("代理配置过长或包含无效字符。".into());
    }
    if proxy.mode == ProxyMode::Manual {
        proxy_url(&proxy.url)?;
    }
    Ok(())
}

fn secrets(url: &str, values: &mut Vec<String>) {
    if url.is_empty() {
        return;
    }
    values.push(url.to_owned());
    if let Ok(url) = Url::parse(url) {
        let user = percent_encoding::percent_decode_str(url.username()).decode_utf8_lossy();
        let password = percent_encoding::percent_decode_str(url.password().unwrap_or_default())
            .decode_utf8_lossy();
        if !password.is_empty() {
            values.push(password.to_string());
            if let Some(encoded) = url.password() {
                values.push(encoded.to_owned());
            }
        }
        if !user.is_empty() {
            values.push(
                base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}")),
            );
        }
    }
}

/// The same environment is used by Pi and network helpers, including future
/// OAuth token exchange/refresh processes. Never mutate the host environment.
pub(super) fn environment(
    proxy: &ProxySettings,
    source: &Path,
) -> Result<ProxyEnvironment, String> {
    validate(proxy)?;
    let mut result = ProxyEnvironment {
        values: HashMap::new(),
        secrets: Vec::new(),
    };
    for key in PROXY_KEYS {
        if let Ok(value) = std::env::var(key) {
            secrets(&value, &mut result.secrets);
        }
    }
    match proxy.mode {
        ProxyMode::Inherit => {
            let settings: Value = match std::fs::read(source.join("settings.json")) {
                Ok(bytes) => serde_json::from_slice(&bytes)
                    .map_err(|_| "本机 Pi 的 settings.json 格式有误。")?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
                Err(_) => return Err("无法读取本机 Pi 网络设置。".into()),
            };
            if let Some(value) = settings["httpProxy"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
            {
                let url = proxy_url(value)?.to_string();
                secrets(value, &mut result.secrets);
                secrets(&url, &mut result.secrets);
                for (upper, lower) in [("HTTP_PROXY", "http_proxy"), ("HTTPS_PROXY", "https_proxy")]
                {
                    if std::env::var(upper)
                        .ok()
                        .filter(|value| !value.is_empty())
                        .is_none()
                        && std::env::var(lower)
                            .ok()
                            .filter(|value| !value.is_empty())
                            .is_none()
                    {
                        result.values.insert(upper.into(), url.clone());
                        result.values.insert(lower.into(), url.clone());
                    }
                }
            }
        }
        ProxyMode::Direct => {
            for key in PROXY_KEYS {
                result.values.insert(key.into(), String::new());
            }
            for key in ["NO_PROXY", "no_proxy"] {
                result.values.insert(key.into(), "*".into());
            }
        }
        ProxyMode::Manual => {
            let url = proxy_url(&proxy.url)?.to_string();
            secrets(&proxy.url, &mut result.secrets);
            secrets(&url, &mut result.secrets);
            for key in PROXY_KEYS {
                result.values.insert(key.into(), url.clone());
            }
            for key in ["NO_PROXY", "no_proxy"] {
                result.values.insert(key.into(), proxy.no_proxy.clone());
            }
        }
    }
    result
        .secrets
        .sort_by_key(|value| std::cmp::Reverse(value.len()));
    result.secrets.dedup();
    Ok(result)
}

pub(super) async fn for_runtime(data: &Path, source: &Path) -> Result<ProxyEnvironment, String> {
    environment(
        &storage::settings(data).await?.proxy.unwrap_or_default(),
        source,
    )
}

fn test_target(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|_| "请输入完整的 HTTP/HTTPS 测试地址。")?;
    if value.len() > 4096
        || !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("测试地址需使用 HTTP/HTTPS，且不能包含账号、密码、查询参数或片段。".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn network_test_proxy(
    app: tauri::AppHandle,
    proxy: ProxySettings,
    target: String,
) -> Result<ProxyTestResult, String> {
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位应用数据目录。")?;
    test(&data, &local_agent_directory()?, &proxy, &target).await
}

pub(super) async fn test(
    data: &Path,
    source: &Path,
    proxy: &ProxySettings,
    target: &str,
) -> Result<ProxyTestResult, String> {
    let target = test_target(target)?;
    let environment = environment(proxy, source)?;
    let script = data.join("runtime/network-test.mjs");
    static INSTALL: Mutex<()> = Mutex::const_new(());
    {
        let _install = INSTALL.lock().await;
        tokio::fs::create_dir_all(script.parent().unwrap())
            .await
            .map_err(|_| "无法准备网络测试。")?;
        let source = include_str!("../../../runtime/network-test.mjs");
        if tokio::fs::read_to_string(&script).await.ok().as_deref() != Some(source) {
            tokio::fs::write(&script, source)
                .await
                .map_err(|_| "无法准备网络测试。")?;
        }
    }
    let dispatcher = dunce::canonicalize(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js"),
    )
    .map_err(|_| "缺少 Pi 网络运行时，请运行 pnpm install。")?;
    let mut command = Command::new("node");
    command
        .arg(script)
        .arg(dispatcher)
        .envs(environment.values)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动网络测试，请检查 Node.js。")?;
    let mut input = child.stdin.take().ok_or("无法启动网络测试。")?;
    input
        .write_all(&serde_json::to_vec(&json!({"target":target.as_str()})).unwrap())
        .await
        .map_err(|_| "无法发送网络测试。")?;
    drop(input);
    let output = timeout(Duration::from_secs(15), child.wait_with_output())
        .await
        .map_err(|_| "连接超时，请检查代理地址和网络。")?
        .map_err(|_| "无法读取网络测试结果。")?;
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "网络测试未完成，请检查代理地址和 Node.js 版本。")?;
    if !output.status.success() || value["success"] != true {
        return Err(value["error"]
            .as_str()
            .unwrap_or("代理连接失败，请检查网络设置。")
            .into());
    }
    Ok(ProxyTestResult {
        status: value["status"].as_u64().ok_or("无效的网络测试结果。")? as u16,
        elapsed_ms: value["elapsedMs"].as_u64().ok_or("无效的网络测试结果。")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi::types::AppSettingsPatch;

    fn root() -> std::path::PathBuf {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/network-tests")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn manual_http_and_socks_override_every_proxy_variable_and_redact_authentication() {
        let source = root();
        for url in [
            "http://alice:pa%40ss@127.0.0.1:7890",
            "https://alice:pa%40ss@proxy.invalid:443",
            "socks5://alice:pa%40ss@127.0.0.1:1080",
            "socks5h://alice:pa%40ss@127.0.0.1:1080",
        ] {
            let proxy = ProxySettings {
                mode: ProxyMode::Manual,
                url: url.into(),
                no_proxy: "localhost,.local".into(),
            };
            let environment = environment(&proxy, &source).unwrap();
            for key in PROXY_KEYS {
                assert_eq!(environment.values[key], proxy_url(url).unwrap().as_str());
            }
            assert_eq!(environment.values["NO_PROXY"], "localhost,.local");
            assert_eq!(environment.values["no_proxy"], "localhost,.local");
            let diagnostic = format!("{url} pa@ss pa%40ss YWxpY2U6cGFAc3M=");
            let redacted = crate::pi::config::redact(diagnostic, &environment.secrets);
            assert!(
                !redacted.contains("pa@ss")
                    && !redacted.contains("pa%40ss")
                    && !redacted.contains("YWxpY2U6cGFAc3M=")
            );
        }
        let direct = environment(
            &ProxySettings {
                mode: ProxyMode::Direct,
                ..Default::default()
            },
            &source,
        )
        .unwrap();
        for key in PROXY_KEYS {
            assert_eq!(direct.values[key], "");
        }
        assert_eq!(direct.values["NO_PROXY"], "*");
        assert_eq!(direct.values["no_proxy"], "*");
    }

    #[tokio::test]
    async fn proxy_preferences_persist_independently_and_invalid_saves_roll_back() {
        let data = root();
        assert!(storage::settings(&data).await.unwrap().proxy.is_none());
        let proxy = ProxySettings {
            mode: ProxyMode::Manual,
            url: "socks5://127.0.0.1:1080".into(),
            ..Default::default()
        };
        storage::update_settings(
            &data,
            AppSettingsPatch {
                proxy: Some(proxy.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            storage::settings(&data).await.unwrap().proxy,
            Some(proxy.clone())
        );
        storage::update_settings(
            &data,
            AppSettingsPatch {
                developer_mode: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        for url in [
            "127.0.0.1:7890",
            "ftp://proxy.invalid",
            "http://proxy.invalid/path",
            "http://proxy.invalid?password=secret",
            "http://proxy.invalid:0",
        ] {
            let invalid = ProxySettings {
                url: url.into(),
                ..proxy.clone()
            };
            assert!(
                storage::update_settings(
                    &data,
                    AppSettingsPatch {
                        proxy: Some(invalid),
                        ..Default::default()
                    }
                )
                .await
                .is_err()
            );
            assert_eq!(
                storage::settings(&data).await.unwrap().proxy,
                Some(proxy.clone())
            );
        }
        assert!(storage::settings(&data).await.unwrap().developer_mode);
        for target in [
            "file:///secret",
            "https://user:pass@host.invalid",
            "https://host.invalid?token=secret",
        ] {
            assert!(test_target(target).is_err());
        }
    }

    #[test]
    fn inherited_pi_proxy_keeps_environment_precedence_and_never_changes_source_configuration() {
        let source = root();
        let content = r#"{"httpProxy":"socks5://proxy-user:source-pass@127.0.0.1:1080","defaultThinkingLevel":"high"}"#;
        std::fs::write(source.join("settings.json"), content).unwrap();
        let result = environment(&ProxySettings::default(), &source).unwrap();
        for (upper, lower) in [("HTTP_PROXY", "http_proxy"), ("HTTPS_PROXY", "https_proxy")] {
            let inherited = [upper, lower]
                .iter()
                .any(|key| std::env::var(key).is_ok_and(|value| !value.is_empty()));
            if inherited {
                assert!(!result.values.contains_key(upper) && !result.values.contains_key(lower));
            } else {
                assert_eq!(
                    result.values[upper],
                    "socks5://proxy-user:source-pass@127.0.0.1:1080"
                );
                assert_eq!(result.values[lower], result.values[upper]);
            }
        }
        assert!(result.secrets.iter().any(|value| value == "source-pass"));
        assert_eq!(
            std::fs::read_to_string(source.join("settings.json")).unwrap(),
            content
        );
    }

    #[tokio::test]
    async fn connection_test_uses_the_real_pi_dispatcher_without_a_model_request() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let target = format!("http://{}/ping", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut request = [0u8; 8192];
            let size = socket.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..size]).starts_with("GET /ping "));
            socket
                .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
                .unwrap();
        });
        let data = root();
        let result = test(
            &data,
            &data,
            &ProxySettings {
                mode: ProxyMode::Direct,
                ..Default::default()
            },
            &target,
        )
        .await
        .unwrap();
        assert_eq!(result.status, 204);
        server.join().unwrap();
    }
}
