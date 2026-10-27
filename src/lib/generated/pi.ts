// Generated from Rust DTOs by `cargo test export_frontend_types`.
// Do not edit manually.

export type ModelInfo = { provider: string, providerName?: string, id: string, name: string, };

export type ComposerCommand = { name: string, description: string, };

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

export type PermissionMode = "ask" | "auto" | "full";

export type ProxyMode = "inherit" | "direct" | "manual";

export type ProxySettings = { mode: ProxyMode, url: string, noProxy: string, };

export type ProxyTestResult = { status: number, elapsedMs: number, };

export type AppSettings = { theme: AppTheme, sidebarOpen: boolean, inspectorOpen: boolean, navigationWidth: number, inspectorWidth: number, expandedProjects: Record<string, boolean>, projectOrder: Array<string>, sessionOrder: Array<string>, pinnedProjects: Array<string>, archivedProjects: Array<string>, removedProjects: Array<string>, thinkingLevel: string | null, defaultModel: ModelInfo | null, defaultPermission: PermissionMode, projectsDirectory: string, customProjectsDirectory: string, filesDirectory: string, customFilesDirectory: string, developerMode: boolean, proxy?: ProxySettings, };

export type AppSettingsPatch = { theme?: AppTheme, sidebarOpen?: boolean, inspectorOpen?: boolean, navigationWidth?: number, inspectorWidth?: number, expandedProjects?: { [key in string]?: boolean }, projectOrder?: Array<string>, sessionOrder?: Array<string>, pinnedProjects?: Array<string>, archivedProjects?: Array<string>, thinkingLevel?: string, defaultModel?: ModelInfo, defaultPermission?: PermissionMode, projectsDirectory?: string, customProjectsDirectory?: string, filesDirectory?: string, customFilesDirectory?: string, developerMode?: boolean, proxy?: ProxySettings, };

export type WorkspaceCatalog = { projects: Array<ProjectInfo>, sessions: Array<SessionInfo>, generalCwd: string, selection: Selection, sessionPreferences: { [key in string]?: SessionPreference }, };

export type ProjectInstructions = { path: string, content: string, };

export type ContextUsage = { tokens: number | null, contextWindow: number, percent: number | null, };

export type RuntimeSnapshot = { instanceId: string, projectPath: string, sessionId: string, sessionFile: string | null, readOnly: string | null, permissionMode: PermissionMode, model: ModelInfo | null, contextUsage?: ContextUsage, models: Array<ModelInfo>, thinkingLevel: string, availableThinkingLevels: Array<string>, messages: Array<ChatMessage>, tools: Array<ToolCall>, timeline: Array<TimelineEntry>, activeRunId: string | null, sequence: number, };

export type ResourceScope = "global" | "project" | "custom";

export type ResourceStatus = "unloaded" | "disabled";

export type ResourceInfo = { name: string, description: string, source: string, scope: ResourceScope, status: ResourceStatus, manualOnly: boolean, enabled: boolean, configuration?: string, };

export type ResourceCatalog = { skills: Array<ResourceInfo>, mcp: Array<ResourceInfo>, warnings: Array<string>, };

export type EventData = { "type": "context_usage_changed", usage: ContextUsage | null, } | { "type": "transcript_replaced", messages: Array<ChatMessage>, tools: Array<ToolCall>, timeline: Array<TimelineEntry>, } | { "type": "run_started", message: ChatMessage, } | { "type": "message_started", message: ChatMessage, } | { "type": "message_delta", messageId: string, contentIndex: number, kind: string, delta: string, } | { "type": "message_completed", message: ChatMessage, } | { "type": "tool_changed", tool: ToolCall, } | { "type": "run_finished", status: string, error: string | null, finishedAt?: number, } | { "type": "status", text: string, } | { "type": "disconnected", error: string | null, };

export type PiEvent = { instanceId: string, projectPath: string, sessionId: string, runId: string | null, sequence: number, data: EventData, };
