use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub provider: String,
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    pub thinking: String,
    pub status: String,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub timestamp: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub attachments: Option<Vec<Attachment>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub started_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub finished_at: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub mime_type: String,
    pub size: u32,
    pub preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub text: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentPreview {
    pub kind: String,
    pub source: Option<String>,
    pub text: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub tool_call_id: String,
    pub run_id: String,
    pub name: String,
    pub summary: String,
    pub arguments: String,
    pub arguments_truncated: bool,
    pub output: String,
    pub output_truncated: bool,
    pub status: String,
    pub approval_id: Option<String>,
    pub duration_ms: Option<u32>,
}

#[derive(Clone, Debug, Serialize, TS)]
pub struct TimelineEntry {
    pub kind: String,
    pub id: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ToolLogPage {
    pub content: String,
    pub next_offset: Option<u32>,
    pub total_bytes: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub path: String,
    pub id: String,
    pub cwd: String,
    pub title: String,
    #[ts(type = "number")]
    pub modified: u64,
    pub message_count: u32,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchResult {
    pub session: SessionInfo,
    pub project_name: String,
    pub snippet: String,
    pub matched_in: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub project_path: Option<String>,
    pub session_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCatalog {
    pub projects: Vec<ProjectInfo>,
    pub sessions: Vec<SessionInfo>,
    pub general_cwd: String,
    pub selection: Selection,
    pub session_preferences: std::collections::HashMap<String, SessionPreference>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionPreference {
    pub pinned: bool,
    pub archived: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum AppTheme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub theme: AppTheme,
    pub sidebar_open: bool,
    pub inspector_open: bool,
    pub navigation_width: f64,
    pub inspector_width: f64,
    #[ts(type = "Record<string, boolean>")]
    pub expanded_projects: std::collections::HashMap<String, bool>,
    pub thinking_level: Option<String>,
    pub projects_directory: String,
    pub custom_projects_directory: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: AppTheme::System,
            sidebar_open: true,
            inspector_open: false,
            navigation_width: 300.0,
            inspector_width: 400.0,
            expanded_projects: Default::default(),
            thinking_level: None,
            projects_directory: String::new(),
            custom_projects_directory: String::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct AppSettingsPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub theme: Option<AppTheme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sidebar_open: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub inspector_open: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub navigation_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub inspector_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub expanded_projects: Option<std::collections::HashMap<String, bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub thinking_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub projects_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub custom_projects_directory: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
pub struct ProjectInstructions {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub instance_id: String,
    pub project_path: String,
    pub session_id: String,
    pub session_file: Option<String>,
    pub read_only: Option<String>,
    pub model: Option<ModelInfo>,
    pub models: Vec<ModelInfo>,
    pub thinking_level: String,
    pub available_thinking_levels: Vec<String>,
    pub messages: Vec<ChatMessage>,
    pub tools: Vec<ToolCall>,
    pub timeline: Vec<TimelineEntry>,
    pub active_run_id: Option<String>,
    #[ts(type = "number")]
    pub sequence: u64,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum EventData {
    TranscriptReplaced {
        messages: Vec<ChatMessage>,
        tools: Vec<ToolCall>,
        timeline: Vec<TimelineEntry>,
    },
    RunStarted {
        message: ChatMessage,
    },
    MessageStarted {
        message: ChatMessage,
    },
    MessageDelta {
        message_id: String,
        content_index: usize,
        kind: String,
        delta: String,
    },
    MessageCompleted {
        message: ChatMessage,
    },
    ToolChanged {
        tool: ToolCall,
    },
    RunFinished {
        status: String,
        error: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        finished_at: Option<f64>,
    },
    Status {
        text: String,
    },
    Disconnected {
        error: Option<String>,
    },
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PiEvent {
    pub instance_id: String,
    pub project_path: String,
    pub session_id: String,
    pub run_id: Option<String>,
    #[ts(type = "number")]
    pub sequence: u64,
    pub data: EventData,
}

#[cfg(test)]
#[test]
fn export_frontend_types() {
    let declarations = [
        ModelInfo::decl(),
        Attachment::decl(),
        AttachmentPreview::decl(),
        ChatMessage::decl(),
        ToolCall::decl(),
        TimelineEntry::decl(),
        ToolLogPage::decl(),
        SessionInfo::decl(),
        SessionSearchResult::decl(),
        ProjectInfo::decl(),
        Selection::decl(),
        SessionPreference::decl(),
        AppTheme::decl(),
        AppSettings::decl(),
        AppSettingsPatch::decl(),
        WorkspaceCatalog::decl(),
        ProjectInstructions::decl(),
        RuntimeSnapshot::decl(),
        EventData::decl(),
        PiEvent::decl(),
    ];
    let source = format!(
        "// Generated from Rust DTOs by `cargo test export_frontend_types`.\n// Do not edit manually.\n\n{}\n",
        declarations
            .iter()
            .map(|declaration| format!("export {declaration}"))
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/generated");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("pi.ts"), source).unwrap();
}
