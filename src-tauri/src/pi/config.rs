use serde_json::{Map, Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

pub struct RuntimeConfig {
    pub environment: HashMap<String, String>,
    pub secrets: Vec<String>,
    pub provider_names: HashMap<String, String>,
}

pub(super) fn mcp_secrets(source: &Path, project: &Path) -> Vec<String> {
    fn collect(value: &Value, sensitive: bool, secrets: &mut Vec<String>) {
        match value {
            Value::Object(fields) => {
                for (key, value) in fields {
                    collect(
                        value,
                        sensitive
                            || matches!(
                                key.as_str(),
                                "headers"
                                    | "env"
                                    | "apiKey"
                                    | "token"
                                    | "password"
                                    | "secret"
                                    | "url"
                            ),
                        secrets,
                    );
                }
            }
            Value::Array(values) => {
                for value in values {
                    collect(value, sensitive, secrets);
                }
            }
            Value::String(value) if sensitive && !value.is_empty() => {
                secrets.push(value.clone());
                for part in value.split("${").skip(1) {
                    if let Some((name, _)) = part.split_once('}') {
                        if let Ok(resolved) = std::env::var(name) {
                            if !resolved.is_empty() {
                                secrets.push(resolved);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let mut secrets = Vec::new();
    for file in [source.join("mcp.json"), project.join(".pi/mcp.json")] {
        if let Ok(bytes) = std::fs::read(file) {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                collect(&value, false, &mut secrets);
            }
        }
    }
    secrets
}

pub fn local_agent_directory() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("PI_CODING_AGENT_DIR") {
        return Ok(path.into());
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .ok_or("无法定位本机 Pi 配置目录。")?;
    Ok(PathBuf::from(home).join(".pi/agent"))
}

// Copy provider metadata, but move every credential/header value into the child
// environment. The application neither changes CC Switch's files nor returns keys.
pub fn prepare_config(source: &Path, target: &Path) -> Result<RuntimeConfig, String> {
    let mut environment = HashMap::new();
    let mut secrets = Vec::new();
    let mut config = match std::fs::read(source.join("models.json")) {
        Ok(bytes) => serde_json::from_slice::<Value>(&bytes)
            .map_err(|_| "本机 Pi 的 models.json 格式有误，请在 CC Switch 中检查配置。")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({"providers": {}}),
        Err(_) => return Err("无法读取本机 Pi 模型配置。".into()),
    };
    let providers = config
        .get_mut("providers")
        .and_then(Value::as_object_mut)
        .ok_or("本机 Pi 模型配置缺少 providers 对象。")?;
    // API-key credentials are supported here. OAuth refresh/import is a separate feature.
    if let Ok(bytes) = std::fs::read(source.join("auth.json")) {
        let auth: Map<String, Value> =
            serde_json::from_slice(&bytes).map_err(|_| "本机 Pi 的 auth.json 格式有误。")?;
        for (provider, entry) in auth {
            if entry["type"] == "api_key"
                && let Some(key) = entry.get("key").and_then(Value::as_str)
            {
                let provider = providers.entry(provider).or_insert_with(|| json!({}));
                provider["apiKey"] = key.into();
            }
        }
    }
    let provider_names = providers
        .iter()
        .filter_map(|(id, provider)| {
            provider["name"]
                .as_str()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(|name| (id.clone(), name.to_owned()))
        })
        .collect();
    for provider in providers.values_mut() {
        protect_values(provider, &mut environment, &mut secrets)?;
    }
    std::fs::create_dir_all(target).map_err(|_| "无法创建 Pi 应用数据目录。")?;
    std::fs::write(
        target.join("models.json"),
        serde_json::to_vec_pretty(&config).unwrap(),
    )
    .map_err(|_| "无法写入 Pi 模型配置。")?;
    std::fs::write(
        target.join("settings.json"),
        serde_json::to_vec(&thinking_settings(source)?).unwrap(),
    )
    .map_err(|_| "无法写入 Pi 运行设置。")?;
    Ok(RuntimeConfig {
        environment,
        secrets,
        provider_names,
    })
}

fn thinking_settings(source: &Path) -> Result<Value, String> {
    let settings: Value = match std::fs::read(source.join("settings.json")) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "本机 Pi 的 settings.json 格式有误。")?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(_) => return Err("无法读取本机 Pi 运行设置。".into()),
    };
    let valid_level = |value: &Value| {
        value.as_str().is_some_and(|level| {
            ["off", "minimal", "low", "medium", "high", "xhigh", "max"].contains(&level)
        })
    };
    let default = settings
        .get("defaultThinkingLevel")
        .filter(|level| valid_level(level))
        .cloned()
        .unwrap_or(json!("medium"));
    let models: Map<String, Value> = settings["modelThinkingLevels"]
        .as_object()
        .map(|models| {
            models
                .iter()
                .filter(|(_, level)| valid_level(level))
                .map(|(model, level)| (model.clone(), level.clone()))
                .collect()
        })
        .unwrap_or_default();
    Ok(json!({"telemetry": false, "defaultThinkingLevel": default, "modelThinkingLevels": models}))
}

pub fn default_thinking_level(
    source: &Path,
    provider: &str,
    model: &str,
) -> Result<String, String> {
    let settings = thinking_settings(source)?;
    Ok(
        settings["modelThinkingLevels"][format!("{provider}/{model}")]
            .as_str()
            .or_else(|| settings["defaultThinkingLevel"].as_str())
            .unwrap_or("medium")
            .into(),
    )
}

fn protect_values(
    value: &mut Value,
    environment: &mut HashMap<String, String>,
    secrets: &mut Vec<String>,
) -> Result<(), String> {
    if let Some(object) = value.as_object_mut() {
        for (name, value) in object {
            if name == "apiKey" {
                protect_secret(value, environment, secrets)?;
            } else if name == "headers" {
                if let Some(headers) = value.as_object_mut() {
                    for value in headers.values_mut() {
                        protect_secret(value, environment, secrets)?;
                    }
                }
            } else {
                protect_values(value, environment, secrets)?;
            }
        }
    } else if let Some(array) = value.as_array_mut() {
        for item in array {
            protect_values(item, environment, secrets)?;
        }
    }
    Ok(())
}

fn protect_secret(
    value: &mut Value,
    environment: &mut HashMap<String, String>,
    secrets: &mut Vec<String>,
) -> Result<(), String> {
    let Some(raw) = value.as_str() else {
        return Ok(());
    };
    if raw.starts_with('!') {
        return Err(
            "当前对话接入支持 API Key；请在 CC Switch 中改用密钥或环境变量，暂不执行凭证命令。"
                .into(),
        );
    }
    let resolved = if let Some(name) = raw.strip_prefix("${").and_then(|s| s.strip_suffix('}')) {
        std::env::var(name).map_err(|_| format!("Pi 所需的环境变量 {name} 未设置。"))?
    } else if let Some(name) = raw.strip_prefix('$') {
        std::env::var(name).map_err(|_| format!("Pi 所需的环境变量 {name} 未设置。"))?
    } else {
        raw.to_owned()
    };
    let name = format!("PI_HEARTH_CREDENTIAL_{}", environment.len());
    if !resolved.is_empty() {
        secrets.push(resolved.clone());
    }
    environment.insert(name.clone(), resolved);
    *value = format!("${{{name}}}").into();
    Ok(())
}

pub(super) fn mask_secrets(mut text: String, secrets: &[String], replacement: &str) -> String {
    let mut secrets: Vec<_> = secrets.iter().filter(|secret| !secret.is_empty()).collect();
    // Hide complete credentials before a shorter value can replace part of them.
    secrets.sort_unstable_by_key(|secret| std::cmp::Reverse(secret.len()));
    for secret in secrets {
        if !secret.bytes().all(|byte| byte.is_ascii_digit()) {
            text = text.replace(secret, replacement);
            continue;
        }
        // MCP environment flags such as "0" must not match inside HTTP 400/404.
        // Numeric credentials are still hidden when they occur as complete values.
        let mut masked = String::with_capacity(text.len());
        let mut copied = 0;
        for (start, value) in text.match_indices(secret.as_str()) {
            let end = start + value.len();
            if (start > 0 && text.as_bytes()[start - 1].is_ascii_digit())
                || text.as_bytes().get(end).is_some_and(u8::is_ascii_digit)
            {
                continue;
            }
            masked.push_str(&text[copied..start]);
            masked.push_str(replacement);
            copied = end;
        }
        masked.push_str(&text[copied..]);
        text = masked;
    }
    text
}

pub fn redact(text: String, secrets: &[String]) -> String {
    mask_secrets(text, secrets, "[已隐藏密钥]")
        .chars()
        .take(1500)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_provider_names_are_trimmed_and_kept_separate_from_provider_ids() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/provider-name-test")
            .join(uuid::Uuid::new_v4().to_string());
        let source = root.join("source");
        std::fs::create_dir_all(&source).unwrap();
        let text = json!({"providers":{"cc-switch-one":{"name":" 火山 Agent Plan ","apiKey":"test-secret"},"blank":{"name":" "},"legacy":{}}}).to_string();
        std::fs::write(source.join("models.json"), &text).unwrap();
        let config = prepare_config(&source, &root.join("prepared")).unwrap();
        assert_eq!(
            config.provider_names,
            HashMap::from([("cc-switch-one".into(), "火山 Agent Plan".into())])
        );
        assert_eq!(
            std::fs::read_to_string(source.join("models.json")).unwrap(),
            text
        );
        assert!(
            !serde_json::to_string(&config.provider_names)
                .unwrap()
                .contains("test-secret")
        );
    }

    #[test]
    fn mcp_credentials_are_redacted_without_changing_source_files() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/mcp-secrets-test")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        let text = json!({"mcpServers":{"fixture":{"url":"https://example.invalid/?key=private-key","headers":{"Authorization":"Bearer private-token"},"env":{"TOKEN":"private-env"}}}}).to_string();
        std::fs::write(root.join("mcp.json"), &text).unwrap();
        let secrets = mcp_secrets(&root, &root);
        let redacted = redact(
            "https://example.invalid/?key=private-key Bearer private-token private-env".into(),
            &secrets,
        );
        assert!(!redacted.contains("private-"));
        assert_eq!(
            std::fs::read_to_string(root.join("mcp.json")).unwrap(),
            text
        );
    }

    #[test]
    fn numeric_mcp_flags_do_not_corrupt_http_errors_or_nested_error_payloads() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/mcp-status-redaction-test")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("mcp.json"),
            json!({"mcpServers":{"fixture":{"env":{
                "NODE_TLS_REJECT_UNAUTHORIZED":"0", "RETRIES":"1", "TOKEN":"private-101-token"
            }}}})
            .to_string(),
        )
        .unwrap();
        let secrets = mcp_secrets(&root, &root);
        let nested = json!({"error":{"code":400,"status":"FAILED_PRECONDITION","token":"private-101-token"}}).to_string();
        let error = json!({"error":{"code":404,"status":"Not Found","message":nested}});
        let redacted: Value = serde_json::from_str(&redact(error.to_string(), &secrets)).unwrap();
        assert_eq!(redacted["error"]["code"], 404);
        assert_eq!(redacted["error"]["status"], "Not Found");
        let nested: Value =
            serde_json::from_str(redacted["error"]["message"].as_str().unwrap()).unwrap();
        assert_eq!(nested["error"]["code"], 400);
        assert_eq!(nested["error"]["token"], "[已隐藏密钥]");
        for status in [400, 401, 403, 404, 408, 429, 500, 502, 503, 504] {
            let error = format!("HTTP {status}");
            assert_eq!(redact(error.clone(), &secrets), error);
        }
    }

    #[test]
    fn numeric_credentials_are_still_hidden_when_they_are_complete_values() {
        let secrets = vec!["0".into(), "1".into(), "7359".into(), String::new()];
        assert_eq!(
            redact(
                "密钥=0，PIN:1，password=7359，HTTP 404 400 401".into(),
                &secrets
            ),
            "密钥=[已隐藏密钥]，PIN:[已隐藏密钥]，password=[已隐藏密钥]，HTTP 404 400 401"
        );
    }

    #[test]
    fn default_effort_uses_model_override_then_global_then_pi_default() {
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/thinking-default-test")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&source).unwrap();
        assert_eq!(
            default_thinking_level(&source, "p", "model").unwrap(),
            "medium"
        );
        std::fs::write(source.join("settings.json"), serde_json::to_vec(&json!({
            "defaultThinkingLevel": "high", "modelThinkingLevels": {"p/model": "xhigh", "p/invalid": "bad"},
            "unrelated": "not copied"
        })).unwrap()).unwrap();
        assert_eq!(
            default_thinking_level(&source, "p", "model").unwrap(),
            "xhigh"
        );
        assert_eq!(
            default_thinking_level(&source, "p", "other").unwrap(),
            "high"
        );
        let settings = thinking_settings(&source).unwrap();
        assert!(settings.get("unrelated").is_none());
        assert!(settings["modelThinkingLevels"].get("p/invalid").is_none());
    }

    #[test]
    fn credentials_are_removed_from_persisted_provider_metadata() {
        let mut provider = json!({"apiKey":"secret-key", "headers":{"Authorization":"Bearer token"},"models":[{"id":"chat", "headers":{"x-key":"other-key"}}]});
        let mut env = HashMap::new();
        let mut secrets = Vec::new();
        protect_values(&mut provider, &mut env, &mut secrets).unwrap();
        let serialized = provider.to_string();
        assert!(!serialized.contains("secret-key"));
        assert!(!serialized.contains("Bearer token"));
        assert!(!serialized.contains("other-key"));
        assert_eq!(env.len(), 3);
        assert_eq!(
            redact("error secret-key".into(), &secrets),
            "error [已隐藏密钥]"
        );
    }

    #[test]
    fn credential_commands_are_not_executed() {
        let mut value = Value::String("!print-private-key".into());
        assert!(protect_secret(&mut value, &mut HashMap::new(), &mut Vec::new()).is_err());
    }
}
