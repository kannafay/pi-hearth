// Generated from Rust DTOs by `cargo test export_frontend_types`.
// Do not edit manually.

export type ModelInfo = { provider: string, id: string, name: string, };

export type Attachment = { id: string, name: string, kind: string, mimeType: string, size: number, preview: string | null, sourcePath?: string, text?: string, };

export type AttachmentPreview = { kind: string, source: string | null, text: string | null, };

export type ChatMessage = { id: string, role: string, text: string, thinking: string, status: string, error: string | null, timestamp?: number, attachments?: Array<Attachment>, startedAt?: number, finishedAt?: number, };

export type ToolCall = { id: string, toolCallId: string, runId: string, name: string, summary: string, arguments: string, argumentsTruncated: boolean, output: string, outputTruncated: boolean, status: string, approvalId: string | null, durationMs: number | null, };

export type TimelineEntry = { kind: string, id: string, };

export type ToolLogPage = { content: string, nextOffset: number | null, totalBytes: number, };

export type SessionInfo = { path: string, id: string, cwd: string, title: string, modified: number, messageCount: number, };

export type SessionSearchResult = { session: SessionInfo, projectName: string, snippet: string, matchedIn: string, };

export type ProjectInfo = { path: string, name: string, };

export type Selection = { projectPath: string | null, sessionPath: string | null, };

export type SessionPreference = { pinned: boolean, archived: boolean, };

export type AppTheme = "system" | "light" | "dark";

export type AppSettings = { theme: AppTheme, sidebarOpen: boolean, inspectorOpen: boolean, navigationWidth: number, inspectorWidth: number, expandedProjects: Record<string, boolean>, projectOrder: Array<string>, sessionOrder: Array<string>, pinnedProjects: Array<string>, archivedProjects: Array<string>, removedProjects: Array<string>, thinkingLevel: string | null, projectsDirectory: string, customProjectsDirectory: string, developerMode: boolean, };

export type AppSettingsPatch = { theme?: AppTheme, sidebarOpen?: boolean, inspectorOpen?: boolean, navigationWidth?: number, inspectorWidth?: number, expandedProjects?: { [key in string]?: boolean }, projectOrder?: Array<string>, sessionOrder?: Array<string>, pinnedProjects?: Array<string>, archivedProjects?: Array<string>, thinkingLevel?: string, projectsDirectory?: string, customProjectsDirectory?: string, developerMode?: boolean, };

export type WorkspaceCatalog = { projects: Array<ProjectInfo>, sessions: Array<SessionInfo>, generalCwd: string, selection: Selection, sessionPreferences: { [key in string]?: SessionPreference }, };

export type ProjectInstructions = { path: string, content: string, };

export type RuntimeSnapshot = { instanceId: string, projectPath: string, sessionId: string, sessionFile: string | null, readOnly: string | null, model: ModelInfo | null, models: Array<ModelInfo>, thinkingLevel: string, availableThinkingLevels: Array<string>, messages: Array<ChatMessage>, tools: Array<ToolCall>, timeline: Array<TimelineEntry>, activeRunId: string | null, sequence: number, };

export type EventData = { "type": "transcript_replaced", messages: Array<ChatMessage>, tools: Array<ToolCall>, timeline: Array<TimelineEntry>, } | { "type": "run_started", message: ChatMessage, } | { "type": "message_started", message: ChatMessage, } | { "type": "message_delta", messageId: string, contentIndex: number, kind: string, delta: string, } | { "type": "message_completed", message: ChatMessage, } | { "type": "tool_changed", tool: ToolCall, } | { "type": "run_finished", status: string, error: string | null, finishedAt?: number, } | { "type": "status", text: string, } | { "type": "disconnected", error: string | null, };

export type PiEvent = { instanceId: string, projectPath: string, sessionId: string, runId: string | null, sequence: number, data: EventData, };
