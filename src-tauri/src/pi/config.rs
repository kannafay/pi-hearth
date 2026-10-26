use serde_json::{Map, Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

pub struct RuntimeConfig {
    pub environment: HashMap<String, String>,
    pub secrets: Vec<String>,
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

pub fn redact(mut text: String, secrets: &[String]) -> String {
    for secret in secrets {
        text = text.replace(secret, "[已隐藏密钥]");
    }
    text.chars().take(1500).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

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
