use super::tool_output::{ARGUMENT_PREVIEW, OUTPUT_PREVIEW, preview, result_text};
use super::types::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use uuid::Uuid;

const MAX_RECORD_BYTES: usize = 8 * 1024 * 1024;

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}

#[derive(Default)]
pub struct JsonLines {
    pending: Vec<u8>,
}

impl JsonLines {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Value>, String> {
        self.push_bounded(bytes, MAX_RECORD_BYTES)
    }

    pub fn push_bounded(&mut self, bytes: &[u8], limit: usize) -> Result<Vec<Value>, String> {
        let mut records = Vec::new();
        for part in bytes.split_inclusive(|byte| *byte == b'\n') {
            if self.pending.len() + part.len() > limit {
                return Err("Pi 返回的单条记录过大，连接已关闭。".into());
            }
            self.pending.extend_from_slice(part);
            if part.last() == Some(&b'\n') {
                if !self.pending.iter().all(u8::is_ascii_whitespace) {
                    records.push(
                        serde_json::from_slice(&self.pending)
                            .map_err(|_| "Pi 返回了无效的 JSONL 协议记录。")?,
                    );
                }
                self.pending.clear();
            }
        }
        Ok(records)
    }
}

pub struct Conversation {
    pub snapshot: RuntimeSnapshot,
    current_message: Option<String>,
    blocks: BTreeMap<usize, (String, String)>,
    last_error: Option<String>,
    cancelled: bool,
}

impl Conversation {
    pub fn new(instance_id: String, project_path: String) -> Self {
        Self {
            snapshot: RuntimeSnapshot {
                instance_id,
                project_path,
                session_id: String::new(),
                session_file: None,
                read_only: None,
                permission_mode: Default::default(),
                model: None,
                models: vec![],
                thinking_level: "off".into(),
                available_thinking_levels: vec![],
                messages: vec![],
                tools: vec![],
                timeline: vec![],
                active_run_id: None,
                sequence: 0,
            },
            current_message: None,
            blocks: BTreeMap::new(),
            last_error: None,
            cancelled: false,
        }
    }

    pub fn renew(&mut self, instance_id: String) {
        let previous = &mut self.snapshot;
        let mut next = Self::new(instance_id, previous.project_path.clone());
        next.snapshot.session_id = std::mem::take(&mut previous.session_id);
        next.snapshot.session_file = previous.session_file.take();
        next.snapshot.model = previous.model.take();
        next.snapshot.permission_mode = previous.permission_mode;
        next.snapshot.models = std::mem::take(&mut previous.models);
        next.snapshot.thinking_level = std::mem::take(&mut previous.thinking_level);
        next.snapshot.available_thinking_levels =
            std::mem::take(&mut previous.available_thinking_levels);
        *self = next;
    }

    pub fn event(&mut self, data: EventData) -> PiEvent {
        self.snapshot.sequence += 1;
        PiEvent {
            instance_id: self.snapshot.instance_id.clone(),
            project_path: self.snapshot.project_path.clone(),
            session_id: self.snapshot.session_id.clone(),
            run_id: self.snapshot.active_run_id.clone(),
            sequence: self.snapshot.sequence,
            data,
        }
    }

    #[cfg(test)]
    pub fn begin(&mut self, run_id: String, text: String) -> Result<Vec<PiEvent>, String> {
        self.begin_with_attachments(run_id, text, None)
    }

    pub fn begin_with_attachments(
        &mut self,
        run_id: String,
        text: String,
        attachments: Option<Vec<Attachment>>,
    ) -> Result<Vec<PiEvent>, String> {
        if self.snapshot.active_run_id.is_some() {
            return Err("当前回复尚未结束。".into());
        }
        self.snapshot.active_run_id = Some(run_id.clone());
        self.last_error = None;
        self.cancelled = false;
        self.current_message = None;
        self.blocks.clear();
        let message = ChatMessage {
            id: format!("{run_id}-user"),
            role: "user".into(),
            text,
            thinking: String::new(),
            status: "complete".into(),
            error: None,
            timestamp: Some(now_ms()),
            attachments,
            started_at: Some(now_ms()),
            finished_at: None,
        };
        self.snapshot.messages.push(message.clone());
        self.snapshot.timeline.push(TimelineEntry {
            kind: "message".into(),
            id: message.id.clone(),
        });
        Ok(vec![self.event(EventData::RunStarted { message })])
    }

    pub fn mark_cancelling(&mut self) {
        self.cancelled = true;
    }

    pub fn is_cancelling(&self) -> bool {
        self.cancelled
    }

    pub fn restore_message(&mut self, raw: &Value) -> Vec<Value> {
        let mut records = vec![];
        if raw["role"] != "user"
            && let Some(finished) = raw["__hearthFinishedAt"].as_f64()
            && let Some(user) = self
                .snapshot
                .messages
                .iter_mut()
                .rev()
                .find(|message| message.role == "user")
            && user.started_at.is_some_and(|started| finished >= started)
        {
            user.finished_at = Some(finished);
        }
        if self.snapshot.active_run_id.is_none() {
            self.snapshot.active_run_id = Some(Uuid::new_v4().to_string());
        }
        match raw["role"].as_str() {
            Some("user") => {
                self.snapshot.active_run_id = Some(Uuid::new_v4().to_string());
                let (text, attachments) = super::attachments::restored_user(raw);
                let message = ChatMessage {
                    id: Uuid::new_v4().to_string(),
                    role: "user".into(),
                    text,
                    thinking: String::new(),
                    status: "complete".into(),
                    error: None,
                    timestamp: raw["timestamp"].as_f64().filter(|time| *time > 0.0),
                    attachments,
                    started_at: raw["timestamp"].as_f64().filter(|time| *time > 0.0),
                    finished_at: None,
                };
                self.snapshot.timeline.push(TimelineEntry {
                    kind: "message".into(),
                    id: message.id.clone(),
                });
                self.snapshot.messages.push(message);
            }
            Some("assistant") => {
                self.record(&json!({"type":"message_start","message":raw}));
                let mut message = raw.clone();
                if message["content"].is_string() {
                    message["content"] = json!([{"type":"text","text":message["content"]}]);
                }
                self.record(&json!({"type":"message_end","message":message}));
                if let Some(message) = self.snapshot.messages.last_mut() {
                    message.timestamp = raw["timestamp"]
                        .as_f64()
                        .filter(|time| *time > 0.0)
                        .or_else(|| raw["__hearthFinishedAt"].as_f64());
                }
                if let Some(blocks) = raw["content"].as_array() {
                    for block in blocks.iter().filter(|block| block["type"] == "toolCall") {
                        let record = json!({"type":"tool_execution_start","toolCallId":block["id"],"toolName":block["name"],"args":block["arguments"]});
                        self.record(&record);
                        records.push(record);
                    }
                }
            }
            Some("toolResult") => {
                let record = json!({"type":"tool_execution_end","toolCallId":raw["toolCallId"],"toolName":raw["toolName"],"result":raw,"isError":raw["isError"],"durationMs":raw["durationMs"]});
                self.record(&record);
                records.push(record);
            }
            Some("bashExecution") => {
                let call = Uuid::new_v4().to_string();
                let start = json!({"type":"tool_execution_start","toolCallId":call,"toolName":"bash","args":{"command":raw["command"]}});
                let end = json!({"type":"tool_execution_end","toolCallId":call,"result":{"content":[{"type":"text","text":raw["output"]}]},"isError":raw["exitCode"].as_i64().is_some_and(|code| code != 0)});
                self.record(&start);
                self.record(&end);
                records.extend([start, end]);
            }
            _ => {}
        }
        records
    }

    pub fn end_restore(&mut self) {
        self.snapshot.active_run_id = None;
        for tool in &mut self.snapshot.tools {
            if matches!(
                tool.status.as_str(),
                "running" | "queued" | "awaiting_approval"
            ) {
                tool.status = "interrupted".into();
                tool.approval_id = None;
            }
        }
    }

    pub fn rewind(&mut self, message_id: &str) -> Result<Vec<PiEvent>, String> {
        if self.snapshot.active_run_id.is_some() {
            return Err("请等待当前回复结束。".into());
        }
        let position = self
            .snapshot
            .timeline
            .iter()
            .position(|entry| entry.kind == "message" && entry.id == message_id)
            .ok_or("这条消息已发生变化，请重新打开会话。")?;
        self.snapshot.timeline.truncate(position);
        self.snapshot.messages.retain(|message| {
            self.snapshot
                .timeline
                .iter()
                .any(|entry| entry.kind == "message" && entry.id == message.id)
        });
        self.snapshot.tools.retain(|tool| {
            self.snapshot
                .timeline
                .iter()
                .any(|entry| entry.kind == "tool" && entry.id == tool.id)
        });
        self.current_message = None;
        self.blocks.clear();
        self.last_error = None;
        self.cancelled = false;
        Ok(vec![self.event(EventData::TranscriptReplaced {
            messages: self.snapshot.messages.clone(),
            tools: self.snapshot.tools.clone(),
            timeline: self.snapshot.timeline.clone(),
        })])
    }

    pub fn tool_index(&self, call_id: &str) -> Option<usize> {
        self.snapshot.tools.iter().position(|tool| {
            tool.tool_call_id == call_id
                && Some(&tool.run_id) == self.snapshot.active_run_id.as_ref()
        })
    }

    pub fn approval_decided(&mut self, call_id: &str, allow: bool) -> Vec<PiEvent> {
        let Some(index) = self.tool_index(call_id) else {
            return vec![];
        };
        let tool = &mut self.snapshot.tools[index];
        tool.approval_id = None;
        tool.status = if self.cancelled {
            "cancelled"
        } else if allow {
            "running"
        } else {
            "denied"
        }
        .into();
        let tool = tool.clone();
        vec![self.event(EventData::ToolChanged { tool })]
    }

    fn tool_record(&mut self, record: &Value) -> Vec<PiEvent> {
        let Some(call_id) = record["toolCallId"].as_str() else {
            return vec![];
        };
        let index = if let Some(index) = self.tool_index(call_id) {
            index
        } else {
            let id = Uuid::new_v4().to_string();
            self.snapshot.timeline.push(TimelineEntry {
                kind: "tool".into(),
                id: id.clone(),
            });
            self.snapshot.tools.push(ToolCall {
                id,
                tool_call_id: call_id.into(),
                run_id: self.snapshot.active_run_id.clone().unwrap(),
                name: record["toolName"].as_str().unwrap_or("tool").into(),
                summary: String::new(),
                arguments: String::new(),
                arguments_truncated: false,
                output: String::new(),
                output_truncated: false,
                status: "running".into(),
                approval_id: None,
                duration_ms: None,
            });
            self.snapshot.tools.len() - 1
        };
        let tool = &mut self.snapshot.tools[index];
        if let Some(args) = record.get("args").filter(|args| args.is_object()) {
            (tool.arguments, tool.arguments_truncated) = preview(
                &serde_json::to_string_pretty(args).unwrap_or_default(),
                ARGUMENT_PREVIEW,
                false,
            );
            let summary = args["path"]
                .as_str()
                .or(args["command"].as_str())
                .unwrap_or_default();
            tool.summary = preview(summary, 240, false).0;
        }
        match record["type"].as_str().unwrap_or_default() {
            "tool_approval" => {
                tool.status = "awaiting_approval".into();
                tool.approval_id = record["approvalId"].as_str().map(str::to_owned);
            }
            "tool_execution_start" => {
                if !matches!(tool.status.as_str(), "denied" | "cancelled") {
                    tool.status = "running".into();
                }
            }
            "tool_execution_update" => {
                (tool.output, tool.output_truncated) =
                    preview(&result_text(&record["partialResult"]), OUTPUT_PREVIEW, true);
            }
            "tool_execution_end" => {
                (tool.output, tool.output_truncated) =
                    preview(&result_text(&record["result"]), OUTPUT_PREVIEW, true);
                if tool.approval_id.is_some() && !self.cancelled {
                    tool.status = "denied".into();
                } else if !matches!(tool.status.as_str(), "denied" | "cancelled") {
                    tool.status = if self.cancelled {
                        "cancelled"
                    } else if record["isError"] == true {
                        "failed"
                    } else {
                        "complete"
                    }
                    .into();
                }
                tool.duration_ms = record["durationMs"]
                    .as_u64()
                    .map(|duration| duration.min(u32::MAX as u64) as u32);
                tool.approval_id = None;
            }
            _ => {}
        }
        let tool = tool.clone();
        vec![self.event(EventData::ToolChanged { tool })]
    }

    pub fn finish(&mut self, status: &str, error: Option<String>) -> Vec<PiEvent> {
        if self.snapshot.active_run_id.is_none() {
            return vec![];
        }
        let finished_at = now_ms();
        if let Some(user) = self
            .snapshot
            .messages
            .iter_mut()
            .rev()
            .find(|message| message.role == "user")
        {
            user.finished_at = Some(finished_at);
        }
        for message in &mut self.snapshot.messages {
            if message.status == "streaming" {
                message.status = status.into();
                message.error = error.clone();
            }
        }
        let mut events = vec![];
        let mut changed = vec![];
        for tool in &mut self.snapshot.tools {
            if Some(&tool.run_id) == self.snapshot.active_run_id.as_ref()
                && matches!(
                    tool.status.as_str(),
                    "awaiting_approval" | "queued" | "running"
                )
            {
                tool.status = if status == "cancelled" {
                    "cancelled"
                } else {
                    "interrupted"
                }
                .into();
                tool.approval_id = None;
                changed.push(tool.clone());
            }
        }
        for tool in changed {
            events.push(self.event(EventData::ToolChanged { tool }));
        }
        events.push(self.event(EventData::RunFinished {
            status: status.into(),
            error,
            finished_at: Some(finished_at),
        }));
        self.snapshot.active_run_id = None;
        events
    }

    pub fn response(&mut self, record: &Value) {
        if record["success"] != true {
            return;
        }
        let data = &record["data"];
        match record["command"].as_str() {
            Some("get_entries") => {
                self.snapshot.permission_mode = data["entries"]
                    .as_array()
                    .and_then(|entries| {
                        entries.iter().rev().find(|entry| {
                            entry["type"] == "custom" && entry["customType"] == "hearth-permission"
                        })
                    })
                    .and_then(|entry| serde_json::from_value(entry["data"]["mode"].clone()).ok())
                    .unwrap_or_default();
            }
            Some("get_state") => {
                self.snapshot.session_id = data["sessionId"].as_str().unwrap_or_default().into();
                self.snapshot.session_file = data["sessionFile"].as_str().map(str::to_owned);
                self.snapshot.model = model_info(&data["model"]);
                self.snapshot.thinking_level =
                    data["thinkingLevel"].as_str().unwrap_or("off").into();
            }
            Some("get_available_models") => {
                self.snapshot.models = data["models"]
                    .as_array()
                    .map(|models| models.iter().filter_map(model_info).collect())
                    .unwrap_or_default();
            }
            Some("set_model") => self.snapshot.model = model_info(data),
            Some("get_available_thinking_levels") => {
                self.snapshot.available_thinking_levels = data["levels"]
                    .as_array()
                    .map(|levels| {
                        levels
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default();
            }
            _ => {}
        }
    }

    pub fn record(&mut self, record: &Value) -> Vec<PiEvent> {
        if self.snapshot.active_run_id.is_none() {
            return vec![];
        }
        match record["type"].as_str().unwrap_or_default() {
            "tool_approval"
            | "tool_execution_start"
            | "tool_execution_update"
            | "tool_execution_end" => self.tool_record(record),
            "message_end" if record["message"]["role"] == "user" => {
                let id = format!(
                    "{}-user",
                    self.snapshot.active_run_id.as_deref().unwrap_or_default()
                );
                if let Some(message) = self
                    .snapshot
                    .messages
                    .iter_mut()
                    .find(|message| message.id == id)
                {
                    message.timestamp = record["message"]["timestamp"]
                        .as_f64()
                        .filter(|time| *time > 0.0)
                        .or(message.timestamp);
                    let message = message.clone();
                    return vec![self.event(EventData::MessageCompleted { message })];
                }
                vec![]
            }
            "message_start" if record["message"]["role"] == "assistant" => {
                self.blocks.clear();
                self.last_error = None;
                let message = ChatMessage {
                    id: Uuid::new_v4().to_string(),
                    role: "assistant".into(),
                    text: String::new(),
                    thinking: String::new(),
                    status: "streaming".into(),
                    error: None,
                    timestamp: record["message"]["timestamp"]
                        .as_f64()
                        .filter(|time| *time > 0.0)
                        .or_else(|| Some(now_ms())),
                    attachments: None,
                    started_at: None,
                    finished_at: None,
                };
                self.current_message = Some(message.id.clone());
                self.snapshot.messages.push(message.clone());
                self.snapshot.timeline.push(TimelineEntry {
                    kind: "message".into(),
                    id: message.id.clone(),
                });
                vec![self.event(EventData::MessageStarted { message })]
            }
            "message_update" => {
                let update = &record["assistantMessageEvent"];
                let kind = match update["type"].as_str() {
                    Some("text_delta") => "text",
                    Some("thinking_delta") => "thinking",
                    _ => return vec![],
                };
                let Some(id) = self.current_message.clone() else {
                    return vec![];
                };
                let index = update["contentIndex"].as_u64().unwrap_or(0) as usize;
                let delta = update["delta"].as_str().unwrap_or_default().to_owned();
                let block = self
                    .blocks
                    .entry(index)
                    .or_insert_with(|| (kind.into(), String::new()));
                block.1.push_str(&delta);
                let text: String = self
                    .blocks
                    .values()
                    .filter(|(kind, _)| kind == "text")
                    .map(|(_, text)| text.as_str())
                    .collect();
                let thinking: String = self
                    .blocks
                    .values()
                    .filter(|(kind, _)| kind == "thinking")
                    .map(|(_, text)| text.as_str())
                    .collect();
                if let Some(message) = self.snapshot.messages.iter_mut().find(|m| m.id == id) {
                    message.text = text;
                    message.thinking = thinking;
                }
                vec![self.event(EventData::MessageDelta {
                    message_id: id,
                    content_index: index,
                    kind: kind.into(),
                    delta,
                })]
            }
            "message_end" if record["message"]["role"] == "assistant" => {
                let Some(id) = self.current_message.take() else {
                    return vec![];
                };
                let raw = &record["message"];
                let mut text = String::new();
                let mut thinking = String::new();
                if let Some(content) = raw["content"].as_array() {
                    for block in content {
                        if block["type"] == "text" {
                            text.push_str(block["text"].as_str().unwrap_or_default());
                        }
                        if block["type"] == "thinking" {
                            thinking.push_str(block["thinking"].as_str().unwrap_or_default());
                        }
                    }
                }
                let status = match raw["stopReason"].as_str() {
                    Some("error") => "failed",
                    Some("aborted") => "cancelled",
                    _ => "complete",
                };
                let error = raw["errorMessage"].as_str().map(str::to_owned);
                self.last_error = if status == "failed" {
                    Some(
                        error
                            .clone()
                            .unwrap_or_else(|| "模型请求失败，请检查模型配置。".into()),
                    )
                } else {
                    None
                };
                let message = ChatMessage {
                    id: id.clone(),
                    role: "assistant".into(),
                    text,
                    thinking,
                    status: status.into(),
                    error,
                    timestamp: raw["timestamp"]
                        .as_f64()
                        .filter(|time| *time > 0.0)
                        .or_else(|| {
                            self.snapshot
                                .messages
                                .iter()
                                .find(|message| message.id == id)
                                .and_then(|message| message.timestamp)
                        }),
                    attachments: None,
                    started_at: None,
                    finished_at: None,
                };
                if let Some(current) = self
                    .snapshot
                    .messages
                    .iter_mut()
                    .find(|m| m.id == message.id)
                {
                    *current = message.clone();
                }
                vec![self.event(EventData::MessageCompleted { message })]
            }
            "agent_settled" => {
                let cancelled = record["aborted"] == true || self.cancelled;
                let status = if cancelled {
                    "cancelled"
                } else if self.last_error.is_some() {
                    "failed"
                } else {
                    "complete"
                };
                self.finish(status, self.last_error.clone())
            }
            "auto_retry_start" => vec![self.event(EventData::Status {
                text: "连接中断，Pi 正在重试…".into(),
            })],
            "auto_compaction_start" => vec![self.event(EventData::Status {
                text: "Pi 正在整理上下文…".into(),
            })],
            _ => vec![],
        }
    }
}

fn model_info(value: &Value) -> Option<ModelInfo> {
    Some(ModelInfo {
        provider: value["provider"].as_str()?.into(),
        id: value["id"].as_str()?.into(),
        name: value["name"].as_str().or(value["id"].as_str())?.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turn_timing_is_finalized_once_and_restored_from_transcript_completion() {
        let mut conversation = Conversation::new("instance".into(), "project".into());
        conversation.begin("run".into(), "hello".into()).unwrap();
        let started = conversation.snapshot.messages[0].started_at.unwrap();
        let events = conversation.finish("complete", None);
        let finished = conversation.snapshot.messages[0].finished_at.unwrap();
        assert!(finished >= started);
        assert!(
            matches!(&events.last().unwrap().data, EventData::RunFinished { finished_at: Some(time), .. } if *time == finished)
        );
        assert!(conversation.finish("complete", None).is_empty());
        assert_eq!(
            conversation.snapshot.messages[0].finished_at,
            Some(finished)
        );

        let mut history = Conversation::new("history".into(), "project".into());
        history.restore_message(&json!({"role":"user", "content":"hello", "timestamp": 100000}));
        history.restore_message(
            &json!({"role":"assistant", "content":"hello", "__hearthFinishedAt":121000}),
        );
        history.end_restore();
        assert_eq!(history.snapshot.messages[0].started_at, Some(100000.0));
        assert_eq!(history.snapshot.messages[0].finished_at, Some(121000.0));
        assert_eq!(history.snapshot.messages[0].timestamp, Some(100000.0));
        assert_eq!(history.snapshot.messages[1].timestamp, Some(121000.0));
    }

    #[test]
    fn rewinding_removes_only_the_selected_turn_and_later_tools() {
        let mut conversation = Conversation::new("instance".into(), "project".into());
        for text in ["first", "second"] {
            conversation.begin(text.into(), text.into()).unwrap();
            conversation.record(&json!({"type":"tool_execution_start","toolCallId":text,"toolName":"read","args":{"path":"a"}}));
            conversation.finish("complete", None);
        }
        let events = conversation.rewind("second-user").unwrap();
        assert_eq!(conversation.snapshot.messages.len(), 1);
        assert_eq!(conversation.snapshot.messages[0].text, "first");
        assert_eq!(conversation.snapshot.tools.len(), 1);
        assert_eq!(conversation.snapshot.tools[0].tool_call_id, "first");
        assert!(matches!(
            events[0].data,
            EventData::TranscriptReplaced { .. }
        ));
        assert!(conversation.rewind("missing").is_err());
        conversation.rewind("first-user").unwrap();
        assert!(conversation.snapshot.timeline.is_empty());
    }

    #[test]
    fn thinking_settings_follow_the_runtime_and_model_capabilities() {
        let mut conversation = Conversation::new("process-1".into(), "project".into());
        conversation.response(
            &json!({"command":"get_state","success":true,"data":{"thinkingLevel":"medium"}}),
        );
        conversation.response(&json!({"command":"get_available_thinking_levels","success":true,"data":{"levels":["off","low","medium","high","max"]}}));
        assert_eq!(conversation.snapshot.thinking_level, "medium");
        assert_eq!(
            conversation.snapshot.available_thinking_levels,
            ["off", "low", "medium", "high", "max"]
        );
        conversation.response(
            &json!({"command":"get_state","success":true,"data":{"thinkingLevel":"max"}}),
        );
        assert_eq!(conversation.snapshot.thinking_level, "max");
        conversation.response(&json!({"command":"get_available_thinking_levels","success":true,"data":{"levels":["off"]}}));
        assert_eq!(conversation.snapshot.available_thinking_levels, ["off"]);
        conversation.response(
            &json!({"command":"get_state","success":false,"data":{"thinkingLevel":"high"}}),
        );
        assert_eq!(conversation.snapshot.thinking_level, "max");
    }
    use serde_json::json;

    #[test]
    fn restored_history_keeps_tool_order_and_never_reexecutes_unfinished_calls() {
        let mut conversation = Conversation::new("process".into(), "project".into());
        conversation.restore_message(&json!({"role":"user","content":"read file"}));
        conversation.restore_message(&json!({"role":"assistant","content":[{"type":"text","text":"reading"},{"type":"toolCall","id":"call1","name":"read","arguments":{"path":"a"}}],"stopReason":"toolUse"}));
        conversation.restore_message(&json!({"role":"toolResult","toolCallId":"call1","toolName":"read","content":[{"type":"text","text":"contents"}],"isError":false}));
        conversation.restore_message(&json!({"role":"assistant","content":[{"type":"toolCall","id":"pending","name":"write","arguments":{"path":"b","content":"never replay"}}],"stopReason":"toolUse"}));
        conversation.restore_message(&json!({"role":"user","content":"next turn"}));
        conversation.end_restore();
        assert!(conversation.snapshot.active_run_id.is_none());
        assert_eq!(conversation.snapshot.tools[0].status, "complete");
        assert_eq!(conversation.snapshot.tools[0].output, "contents");
        assert_eq!(conversation.snapshot.tools[1].status, "interrupted");
        assert!(
            conversation
                .snapshot
                .tools
                .iter()
                .all(|tool| tool.approval_id.is_none())
        );
        assert_eq!(
            conversation
                .snapshot
                .timeline
                .iter()
                .filter(|item| item.kind == "tool")
                .count(),
            2
        );
    }

    #[test]
    fn tools_replace_partial_output_preserve_denial_and_keep_timeline_order() {
        let mut conversation = Conversation::new("process".into(), "project".into());
        conversation.begin("run".into(), "hello".into()).unwrap();
        conversation.record(&json!({"type":"message_start","message":{"role":"assistant"}}));
        conversation.record(&json!({"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"toolUse"}}));
        conversation.record(&json!({"type":"tool_execution_start","toolCallId":"source/1","toolName":"powershell","args":{"command":"example"}}));
        conversation.record(&json!({"type":"tool_approval","toolCallId":"source/1","toolName":"powershell","args":{"command":"example"},"approvalId":"approve"}));
        assert_eq!(conversation.snapshot.tools[0].status, "awaiting_approval");
        conversation.approval_decided("source/1", false);
        for text in ["a", "ab"] {
            conversation.record(&json!({"type":"tool_execution_update","toolCallId":"source/1","partialResult":{"content":[{"type":"text","text":text}]}}));
        }
        assert_eq!(conversation.snapshot.tools[0].output, "ab");
        conversation.record(&json!({"type":"tool_execution_end","toolCallId":"source/1","result":{"content":[{"type":"text","text":"denied"}]},"isError":true}));
        assert_eq!(conversation.snapshot.tools[0].status, "denied");
        conversation.record(&json!({"type":"message_start","message":{"role":"assistant"}}));
        assert_eq!(
            conversation
                .snapshot
                .timeline
                .iter()
                .map(|item| item.kind.as_str())
                .collect::<Vec<_>>(),
            ["message", "message", "tool", "message"]
        );
        conversation.record(&json!({"type":"tool_execution_start","toolCallId":"other","toolName":"read","args":{"path":"a"}}));
        conversation.mark_cancelling();
        conversation.finish("cancelled", None);
        assert_eq!(conversation.snapshot.tools[1].status, "cancelled");
        conversation.begin("run2".into(), "again".into()).unwrap();
        conversation.record(&json!({"type":"tool_execution_start","toolCallId":"source/1","toolName":"read","args":{"path":"b"}}));
        assert_eq!(conversation.snapshot.tools.len(), 3);
    }

    #[test]
    fn framing_handles_fragmented_utf8_crlf_and_unicode_separators() {
        let wire =
            "{\"type\":\"event\",\"text\":\"中文\u{2028}正文\u{2029}\"}\r\n{\"type\":\"next\"}\n"
                .as_bytes();
        let mut decoder = JsonLines::default();
        let mut records = vec![];
        for byte in wire {
            records.extend(decoder.push(&[*byte]).unwrap());
        }
        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["text"], "中文\u{2028}正文\u{2029}");
    }

    #[test]
    fn protocol_does_not_finish_at_agent_end_and_uses_authoritative_message() {
        let mut conversation = Conversation::new("process-1".into(), "project".into());
        conversation.begin("run-1".into(), "hello".into()).unwrap();
        conversation.record(&json!({"type":"message_start","message":{"role":"assistant"}}));
        conversation.record(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"partial"}}));
        assert_eq!(conversation.snapshot.messages[1].text, "partial");
        conversation.record(&json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"final"}],"stopReason":"stop"}}));
        assert!(conversation.record(&json!({"type":"agent_end"})).is_empty());
        assert!(conversation.snapshot.active_run_id.is_some());
        conversation.record(&json!({"type":"agent_settled","aborted":false}));
        assert!(conversation.snapshot.active_run_id.is_none());
        assert_eq!(conversation.snapshot.messages[1].text, "final");
    }

    #[test]
    fn cancellation_and_provider_errors_have_distinct_final_states() {
        let mut conversation = Conversation::new("process-1".into(), "project".into());
        conversation.begin("run-1".into(), "hello".into()).unwrap();
        conversation.record(&json!({"type":"message_start","message":{"role":"assistant"}}));
        conversation.record(&json!({"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"auth failed"}}));
        let events = conversation.record(&json!({"type":"agent_settled","aborted":false}));
        assert!(
            matches!(&events[0].data, EventData::RunFinished {status, error:Some(error), ..} if status == "failed" && error == "auth failed")
        );
        conversation.begin("run-2".into(), "hello".into()).unwrap();
        conversation.mark_cancelling();
        let events = conversation.record(&json!({"type":"agent_settled","aborted":false}));
        assert!(
            matches!(&events[0].data, EventData::RunFinished {status,..} if status == "cancelled")
        );
    }

    #[test]
    fn permission_metadata_uses_the_latest_entry_and_defaults_legacy_sessions_to_ask() {
        let mut conversation = Conversation::new("runtime".into(), "project".into());
        conversation.response(
            &json!({"success":true,"command":"get_entries","data":{"entries":[
                {"type":"custom","customType":"hearth-permission","data":{"mode":"full"}},
                {"type":"custom","customType":"other","data":{"mode":"ask"}},
                {"type":"custom","customType":"hearth-permission","data":{"mode":"auto"}}
            ]}}),
        );
        assert_eq!(conversation.snapshot.permission_mode, PermissionMode::Auto);
        conversation.renew("reattached".into());
        assert_eq!(conversation.snapshot.permission_mode, PermissionMode::Auto);
        conversation
            .response(&json!({"success":true,"command":"get_entries","data":{"entries":[]}}));
        assert_eq!(conversation.snapshot.permission_mode, PermissionMode::Ask);
        conversation.response(
            &json!({"success":true,"command":"get_entries","data":{"entries":[
                {"type":"custom","customType":"hearth-permission","data":{"mode":"invalid"}}
            ]}}),
        );
        assert_eq!(conversation.snapshot.permission_mode, PermissionMode::Ask);
    }
}
