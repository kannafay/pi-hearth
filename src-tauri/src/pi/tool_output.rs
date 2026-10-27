use super::types::ToolLogPage;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

pub const ARGUMENT_PREVIEW: usize = 16 * 1024;
pub const OUTPUT_PREVIEW: usize = 12 * 1024;
const PAGE_BYTES: usize = 64 * 1024;

pub fn preview(text: &str, limit: usize, tail: bool) -> (String, bool) {
    if text.len() <= limit {
        return (text.into(), false);
    }
    let mut boundary = if tail { text.len() - limit } else { limit };
    while !text.is_char_boundary(boundary) {
        if tail {
            boundary += 1;
        } else {
            boundary -= 1;
        }
    }
    (
        if tail {
            &text[boundary..]
        } else {
            &text[..boundary]
        }
        .into(),
        true,
    )
}

pub fn result_text(result: &Value) -> String {
    result["content"]
        .as_array()
        .map(|content| {
            content
                .iter()
                .filter_map(|block| match block["type"].as_str() {
                    Some("text") => block["text"].as_str().map(str::to_owned),
                    Some("image") => Some("[图片结果，暂不预览]".into()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

pub fn mask(text: &str, secrets: &[String]) -> String {
    super::config::mask_secrets(text.to_owned(), secrets, "[REDACTED]")
}

pub struct ToolOutput {
    directory: PathBuf,
}

impl ToolOutput {
    pub async fn new(directory: &Path) -> Result<Self, String> {
        tokio::fs::create_dir_all(directory)
            .await
            .map_err(|_| "无法创建工具输出目录。")?;
        Ok(Self {
            directory: directory.into(),
        })
    }

    fn path(&self, id: &str, section: &str) -> Result<PathBuf, String> {
        if uuid::Uuid::parse_str(id).is_err() || !matches!(section, "arguments" | "output") {
            return Err("无效的工具输出请求。".into());
        }
        Ok(self.directory.join(format!("{id}-{section}.txt")))
    }

    pub async fn write(&self, id: &str, section: &str, text: &str) -> Result<(), String> {
        tokio::fs::write(self.path(id, section)?, text)
            .await
            .map_err(|_| "无法保存工具输出。".into())
    }

    pub async fn page(&self, id: &str, section: &str, offset: u32) -> Result<ToolLogPage, String> {
        let mut file = tokio::fs::File::open(self.path(id, section)?)
            .await
            .map_err(|_| "工具输出尚不可用。")?;
        let total = file
            .metadata()
            .await
            .map_err(|_| "无法读取工具输出。")?
            .len();
        if u64::from(offset) > total {
            return Err("输出位置已失效，请重新加载。".into());
        }
        file.seek(std::io::SeekFrom::Start(u64::from(offset)))
            .await
            .map_err(|_| "无法读取工具输出。")?;
        let mut bytes = vec![];
        file.take(PAGE_BYTES as u64)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "无法读取工具输出。")?;
        let length = match std::str::from_utf8(&bytes) {
            Ok(_) => bytes.len(),
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => return Err("输出位置不是有效的文本边界，请重新加载。".into()),
        };
        bytes.truncate(length);
        let next = u64::from(offset) + length as u64;
        Ok(ToolLogPage {
            content: String::from_utf8(bytes).unwrap(),
            next_offset: (next < total).then_some(next as u32),
            total_bytes: total as u32,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_previews_preserve_unicode_and_text_results_only() {
        let value = "中文内容".repeat(20000);
        let (tail, truncated) = preview(&value, OUTPUT_PREVIEW, true);
        assert!(truncated && tail.len() <= OUTPUT_PREVIEW && value.ends_with(&tail));
        let (head, _) = preview(&value, ARGUMENT_PREVIEW, false);
        assert!(value.starts_with(&head));
        assert_eq!(
            mask("key SECRET text", &["SECRET".into()]),
            "key [REDACTED] text"
        );
        assert_eq!(
            result_text(
                &serde_json::json!({"content":[{"type":"image","data":"secret blob"},{"type":"text","text":"ok"}]})
            ),
            "[图片结果，暂不预览]\nok"
        );
    }

    #[test]
    fn numeric_flags_preserve_status_codes_in_tool_output() {
        assert_eq!(
            mask(
                "HTTP 404 400 401; 密钥=0; token=private-101-token",
                &["0".into(), "1".into(), "private-101-token".into()],
            ),
            "HTTP 404 400 401; 密钥=[REDACTED]; token=[REDACTED]"
        );
    }

    #[tokio::test]
    async fn pages_use_safe_keys_and_utf8_boundaries() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/output-test")
            .join(uuid::Uuid::new_v4().to_string());
        let output = ToolOutput::new(&directory).await.unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let text = "中文🙂".repeat(30000);
        output.write(&id, "output", &text).await.unwrap();
        let mut offset = 0;
        let mut loaded = String::new();
        loop {
            let page = output.page(&id, "output", offset).await.unwrap();
            assert!(page.content.len() <= PAGE_BYTES);
            loaded.push_str(&page.content);
            if let Some(next) = page.next_offset {
                offset = next;
            } else {
                break;
            }
        }
        assert_eq!(loaded, text);
        assert!(output.page("../escape", "output", 0).await.is_err());
        assert!(output.page(&id, "../escape", 0).await.is_err());
        assert!(output.page(&id, "output", 1).await.is_err());
    }
}
