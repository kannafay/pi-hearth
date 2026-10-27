import type { Attachment, ChatMessage, TimelineEntry, ToolCall } from '@/lib/generated/pi'

type Transcript = { messages: ChatMessage[]; tools: ToolCall[]; timeline: TimelineEntry[] }

function sameAttachment(a: Attachment, b: Attachment) {
  return (
    a.name === b.name &&
    a.kind === b.kind &&
    a.text === b.text &&
    (a.sourcePath && b.sourcePath ? a.sourcePath === b.sourcePath : a.preview === b.preview)
  )
}

function sameMessage(a: ChatMessage | undefined, b: ChatMessage) {
  const attachments = a?.attachments ?? []
  const other = b.attachments ?? []
  return (
    a?.role === b.role &&
    a.text === b.text &&
    a.thinking === b.thinking &&
    a.status === b.status &&
    a.error === b.error &&
    a.phase === b.phase &&
    attachments.length === other.length &&
    attachments.every((attachment, index) => sameAttachment(attachment, other[index]))
  )
}

function sameTool(a: ToolCall | undefined, b: ToolCall) {
  return (
    a?.toolCallId === b.toolCallId &&
    a.name === b.name &&
    a.summary === b.summary &&
    a.arguments === b.arguments &&
    a.argumentsTruncated === b.argumentsTruncated &&
    a.output === b.output &&
    a.outputTruncated === b.outputTruncated &&
    a.status === b.status &&
    a.approvalId === b.approvalId
  )
}

function reuseArray<T>(previous: T[], next: T[]) {
  return previous.length === next.length && next.every((item, index) => item === previous[index])
    ? previous
    : next
}

// Native restore regenerates presentation IDs and timing metadata. Retain stable
// display objects for unchanged content, and bind actions to the fresh runtime IDs.
export function reconcileTranscript(previous: Transcript, next: Transcript) {
  const runtimeMessageIds: Record<string, string> = {}
  const runtimeToolIds: Record<string, string> = {}
  const ids = new Map<string, string>()
  const messages = reuseArray(
    previous.messages,
    next.messages.map((message, index) => {
      const before = previous.messages[index]
      const displayed = sameMessage(before, message) ? before! : message
      ids.set(`message:${message.id}`, displayed.id)
      if (displayed.id !== message.id) runtimeMessageIds[displayed.id] = message.id
      return displayed
    }),
  )
  const tools = reuseArray(
    previous.tools,
    next.tools.map((tool, index) => {
      const before = previous.tools[index]
      const displayed = sameTool(before, tool) ? before! : tool
      ids.set(`tool:${tool.id}`, displayed.id)
      if (displayed.id !== tool.id) runtimeToolIds[displayed.id] = tool.id
      return displayed
    }),
  )
  const timeline = reuseArray(
    previous.timeline,
    next.timeline.map((entry, index) => {
      const id = ids.get(`${entry.kind}:${entry.id}`) ?? entry.id
      const before = previous.timeline[index]
      return before?.kind === entry.kind && before.id === id ? before : { ...entry, id }
    }),
  )
  return { messages, tools, timeline, runtimeMessageIds, runtimeToolIds }
}
