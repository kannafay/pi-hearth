use super::{attachments::restored_user, types::RuntimeSnapshot};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

pub struct Rewrite {
    pub entry_id: String,
    pub parent_id: Value,
    pub prompt: Value,
}

fn branch(data: &Value) -> Result<Vec<&Value>, String> {
    let entries = data["entries"].as_array().ok_or("无法读取会话记录。")?;
    let index: HashMap<_, _> = entries
        .iter()
        .filter_map(|entry| entry["id"].as_str().map(|id| (id, entry)))
        .collect();
    let mut result = vec![];
    let mut seen = HashSet::new();
    let mut cursor = &data["leafId"];
    while !cursor.is_null() {
        let id = cursor.as_str().ok_or("会话分支标识无效。")?;
        if !seen.insert(id) {
            return Err("会话分支存在循环。".into());
        }
        let entry = index.get(id).ok_or("会话记录已变化，请重新打开会话。")?;
        result.push(*entry);
        cursor = &entry["parentId"];
    }
    result.reverse();
    Ok(result)
}

pub fn prepare(
    snapshot: &RuntimeSnapshot,
    data: &Value,
    message_id: &str,
    replacement: Option<&str>,
) -> Result<Rewrite, String> {
    if snapshot.active_run_id.is_some() || snapshot.read_only.is_some() {
        return Err("当前会话暂不能修改消息。".into());
    }
    let visible: Vec<_> = snapshot
        .messages
        .iter()
        .filter(|message| message.role == "user")
        .collect();
    let position = visible
        .iter()
        .position(|message| message.id == message_id)
        .ok_or("这条消息已发生变化，请重新打开会话。")?;
    let entries = branch(data)?;
    let users: Vec<_> = entries
        .into_iter()
        .filter(|entry| entry["type"] == "message" && entry["message"]["role"] == "user")
        .collect();
    if users.len() != visible.len()
        || users
            .iter()
            .zip(&visible)
            .any(|(entry, message)| restored_user(&entry["message"]).0 != message.text)
    {
        return Err("会话记录已变化，请重新打开会话后重试。".into());
    }
    let source = visible[position];
    let entry = users[position];
    let entry_id = entry["id"]
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        })
        .ok_or("消息标识无效。")?
        .to_owned();
    let content = &entry["message"]["content"];
    let original = content.as_str().map(str::to_owned).unwrap_or_else(|| {
        content
            .as_array()
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|block| block["type"] == "text")
                    .filter_map(|block| block["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default()
    });
    let display = replacement.unwrap_or(&source.text);
    if display.trim().is_empty() && source.attachments.as_ref().is_none_or(Vec::is_empty) {
        return Err("请输入消息。".into());
    }
    let prefix = original
        .strip_suffix(&source.text)
        .ok_or("无法还原消息附件。")?;
    let text = format!("{prefix}{display}");
    if text.len() > 256 * 1024 {
        return Err("消息与文本附件内容合计不能超过 256 KiB。".into());
    }
    let images: Vec<_> = content
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block["type"] == "image")
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    Ok(Rewrite {
        entry_id,
        parent_id: entry["parentId"].clone(),
        prompt: json!({"type":"prompt", "message":text, "images":images, "__hearthMessage":display, "__hearthAttachments":source.attachments}),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi::protocol::Conversation;

    #[test]
    fn edits_use_the_active_branch_and_keep_sent_attachment_payloads() {
        let raw = json!({"role":"user","content":[{"type":"text","text":"<file name=\"note.txt\">\nsaved contents\n</file>\nold"},{"type":"image","mimeType":"image/png","data":"AAAA"}],"timestamp":1000});
        let mut conversation = Conversation::new("instance".into(), "project".into());
        conversation.restore_message(&raw);
        conversation.end_restore();
        let data = json!({"leafId":"answer","entries":[
            {"type":"message","id":"old-branch","parentId":null,"message":{"role":"user","content":"discarded"}},
            {"type":"message","id":"prompt","parentId":null,"message":raw},
            {"type":"message","id":"answer","parentId":"prompt","message":{"role":"assistant"}}
        ]});
        let id = &conversation.snapshot.messages[0].id;
        let edit = prepare(&conversation.snapshot, &data, id, Some("new")).unwrap();
        assert_eq!(edit.entry_id, "prompt");
        assert!(edit.parent_id.is_null());
        assert_eq!(
            edit.prompt["message"],
            "<file name=\"note.txt\">\nsaved contents\n</file>\nnew"
        );
        assert_eq!(edit.prompt["images"][0]["data"], "AAAA");
        let retry = prepare(&conversation.snapshot, &data, id, None).unwrap();
        assert!(retry.prompt["message"].as_str().unwrap().ends_with("old"));
        let mut changed = data.clone();
        changed["entries"][1]["message"]["content"] = json!("external change");
        assert!(prepare(&conversation.snapshot, &changed, id, None).is_err());
        assert!(prepare(&conversation.snapshot, &data, "missing", None).is_err());
        let mut cycle = data;
        cycle["entries"][1]["parentId"] = json!("answer");
        assert!(prepare(&conversation.snapshot, &cycle, id, None).is_err());
    }
}
