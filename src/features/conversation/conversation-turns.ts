import type { ChatMessage, TimelineEntry, ToolCall } from '@/lib/generated/pi'

export type ProcessItem =
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'message'; id: string; message: ChatMessage }
  | { kind: 'tool'; id: string; tool: ToolCall }

export interface ConversationTurnData {
  id: string
  user: ChatMessage | null
  process: ProcessItem[]
  reply: ChatMessage | null
  lastAssistant: ChatMessage | null
}

type Entry = { kind: 'message'; message: ChatMessage } | { kind: 'tool'; tool: ToolCall }

export function buildConversationTurns(
  messages: ChatMessage[],
  tools: ToolCall[],
  timeline: TimelineEntry[],
): ConversationTurnData[] {
  const messageById = new Map(messages.map((message) => [message.id, message]))
  const toolById = new Map(tools.map((tool) => [tool.id, tool]))
  const entries = timeline.length
    ? timeline
    : messages.map((message) => ({ kind: 'message', id: message.id }))
  const groups: { id: string; user: ChatMessage | null; entries: Entry[] }[] = []

  // The native timeline supplies ordering; each user message starts a new turn.
  for (const entry of entries) {
    const message = entry.kind === 'message' ? messageById.get(entry.id) : undefined
    const tool = entry.kind === 'tool' ? toolById.get(entry.id) : undefined
    if (!message && !tool) continue
    if (message?.role === 'user') {
      groups.push({ id: message.id, user: message, entries: [] })
      continue
    }
    if (!groups.length) groups.push({ id: `process-${entry.id}`, user: null, entries: [] })
    const group = groups[groups.length - 1]
    if (message) group.entries.push({ kind: 'message', message })
    else if (tool) group.entries.push({ kind: 'tool', tool })
  }

  return groups.map((group) => {
    const tail = group.entries.at(-1)
    // A statement followed by another tool is progress, rather than the final answer.
    const reply = tail?.kind === 'message' && tail.message.text.trim() ? tail.message : null
    let lastAssistant: ChatMessage | null = null
    const process: ProcessItem[] = []
    for (const entry of group.entries) {
      if (entry.kind === 'tool') {
        process.push({ kind: 'tool', id: entry.tool.id, tool: entry.tool })
        continue
      }
      const message = entry.message
      lastAssistant = message
      if (message.thinking.trim()) {
        process.push({ kind: 'thinking', id: `${message.id}-thinking`, text: message.thinking })
      }
      if (message !== reply && message.text.trim()) {
        process.push({ kind: 'message', id: message.id, message })
      }
    }
    return { id: group.id, user: group.user, process, reply, lastAssistant }
  })
}
