import type { ChatMessage, TimelineEntry, ToolCall } from '@/lib/generated/pi'
import { sessionCacheKey } from './session-cache'

export type ProcessItem =
  | { kind: 'thinking'; id: string; text: string; streaming: boolean }
  | { kind: 'message'; id: string; message: ChatMessage }
  | { kind: 'tool'; id: string; tool: ToolCall }

export interface ConversationTurnData {
  id: string
  user: ChatMessage | null
  process: ProcessItem[]
  reply: ChatMessage | null
  lastAssistant: ChatMessage | null
  summary: ChatMessage | null
}

type Entry = { kind: 'message'; message: ChatMessage } | { kind: 'tool'; tool: ToolCall }
type Group = { id: string; user: ChatMessage | null; entries: Entry[] }

function isSummary(message: ChatMessage) {
  return message.role === 'compactionSummary' || message.role === 'branchSummary'
}

function groupConversation(
  messages: ChatMessage[],
  tools: ToolCall[],
  timeline: TimelineEntry[],
): Group[] {
  const messageById = new Map(messages.map((message) => [message.id, message]))
  const toolById = new Map(tools.map((tool) => [tool.id, tool]))
  const entries = timeline.length
    ? timeline
    : messages.map((message) => ({ kind: 'message', id: message.id }))
  const groups: Group[] = []

  // The native timeline supplies ordering; each user message starts a new turn.
  for (const entry of entries) {
    const message = entry.kind === 'message' ? messageById.get(entry.id) : undefined
    const tool = entry.kind === 'tool' ? toolById.get(entry.id) : undefined
    if (!message && !tool) continue
    if (message?.role === 'user') {
      groups.push({ id: message.id, user: message, entries: [] })
      continue
    }
    if (message && isSummary(message)) {
      groups.push({ id: message.id, user: null, entries: [{ kind: 'message', message }] })
      continue
    }
    const previous = groups.at(-1)?.entries[0]
    if (!groups.length || (previous?.kind === 'message' && isSummary(previous.message)))
      groups.push({ id: `process-${entry.id}`, user: null, entries: [] })
    const group = groups[groups.length - 1]
    if (message) group.entries.push({ kind: 'message', message })
    else if (tool) group.entries.push({ kind: 'tool', tool })
  }

  return groups
}

function buildTurn(group: Group): ConversationTurnData {
  const tail = group.entries.at(-1)
  if (tail?.kind === 'message' && isSummary(tail.message))
    return {
      id: group.id,
      user: null,
      process: [],
      reply: null,
      lastAssistant: null,
      summary: tail.message,
    }
  // Pi's completed message metadata distinguishes progress before the tool event arrives.
  // Keep an explicit answer separate even if post-answer work follows it.
  let explicitAnswer: ChatMessage | null = null
  for (let index = group.entries.length - 1; index >= 0; index--) {
    const entry = group.entries[index]
    if (
      entry.kind === 'message' &&
      ['final_answer', 'partial_answer'].includes(entry.message.phase ?? '') &&
      entry.message.text.trim()
    ) {
      explicitAnswer = entry.message
      break
    }
  }
  const reply =
    tail?.kind === 'message' && tail.message.phase !== 'commentary' && tail.message.text.trim()
      ? tail.message
      : explicitAnswer
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
      process.push({
        kind: 'thinking',
        id: `${message.id}-thinking`,
        text: message.thinking,
        streaming: message.status === 'streaming' && !message.text.trim(),
      })
    }
    if (message !== reply && message.text.trim()) {
      process.push({ kind: 'message', id: message.id, message })
    }
  }
  return { id: group.id, user: group.user, process, reply, lastAssistant, summary: null }
}

export function buildConversationTurns(
  messages: ChatMessage[],
  tools: ToolCall[],
  timeline: TimelineEntry[],
): ConversationTurnData[] {
  return groupConversation(messages, tools, timeline).map(buildTurn)
}

interface Transcript {
  messages: ChatMessage[]
  tools: ToolCall[]
  timeline: TimelineEntry[]
  sessionFile: string | null
  sessionId?: string | null
  instanceId: string | null
}

interface ConversationView {
  ids: string[]
  turns: ReadonlyMap<string, ConversationTurnData>
}

function sameTurn(previous: ConversationTurnData | undefined, next: ConversationTurnData) {
  return (
    previous?.user === next.user &&
    previous?.reply === next.reply &&
    previous?.lastAssistant === next.lastAssistant &&
    previous?.summary === next.summary &&
    previous?.process.length === next.process.length &&
    previous.process.every((item, index) => {
      const other = next.process[index]
      return (
        item.kind === other.kind &&
        item.id === other.id &&
        (item.kind === 'thinking'
          ? item.text === (other as typeof item).text &&
            item.streaming === (other as typeof item).streaming
          : item.kind === 'tool'
            ? item.tool === (other as typeof item).tool
            : item.message === (other as typeof item).message)
      )
    })
  )
}

// Source snapshots remain immutable; only changed groups are rebuilt during deltas.
export function createConversationViewSelector() {
  const snapshots = new WeakMap<Transcript, ConversationView>()
  let previous: Transcript | undefined
  let view: ConversationView = { ids: [], turns: new Map() }
  let groups = new Map<string, Group>()
  let messageLocations = new Map<string, { group: Group; index: number }>()
  let toolLocations = new Map<string, { group: Group; index: number }>()

  return (state: Transcript): ConversationView => {
    const cached = snapshots.get(state)
    if (cached) return cached
    const sameSession =
      previous !== undefined && sessionCacheKey(previous) === sessionCacheKey(state)
    const structural =
      !previous ||
      !sameSession ||
      previous.timeline !== state.timeline ||
      previous.messages.length !== state.messages.length ||
      previous.tools.length !== state.tools.length ||
      (previous.messages !== state.messages &&
        state.messages.some(
          (message, index) =>
            message.id !== previous!.messages[index]?.id ||
            message.role !== previous!.messages[index]?.role,
        )) ||
      (previous.tools !== state.tools &&
        state.tools.some((tool, index) => tool.id !== previous!.tools[index]?.id))
    if (structural) {
      const nextGroups = groupConversation(state.messages, state.tools, state.timeline)
      groups = new Map(nextGroups.map((group) => [group.id, group]))
      messageLocations = new Map()
      toolLocations = new Map()
      for (const group of nextGroups) {
        // A user's position is separate from the assistant/tool entries.
        if (group.user) messageLocations.set(group.user.id, { group, index: -1 })
        group.entries.forEach((entry, index) => {
          if (entry.kind === 'message') messageLocations.set(entry.message.id, { group, index })
          else toolLocations.set(entry.tool.id, { group, index })
        })
      }
      const ids = nextGroups.map((group) => group.id)
      const turns = new Map(
        nextGroups.map((group) => {
          const next = buildTurn(group)
          const old = sameSession ? view.turns.get(group.id) : undefined
          return [group.id, sameTurn(old, next) ? old! : next]
        }),
      )
      view = {
        ids:
          sameSession &&
          ids.length === view.ids.length &&
          ids.every((id, index) => id === view.ids[index])
            ? view.ids
            : ids,
        turns,
      }
    } else if (
      previous &&
      (previous.messages !== state.messages || previous.tools !== state.tools)
    ) {
      const changed = new Set<string>()
      const update = (entry: ChatMessage | ToolCall, kind: 'message' | 'tool') => {
        const location = (kind === 'message' ? messageLocations : toolLocations).get(entry.id)
        if (!location) return
        const { group, index } = location
        if (index === -1) group.user = entry as ChatMessage
        else
          group.entries[index] =
            kind === 'message'
              ? { kind, message: entry as ChatMessage }
              : { kind, tool: entry as ToolCall }
        changed.add(group.id)
      }
      if (previous.messages !== state.messages)
        state.messages.forEach((message, index) => {
          if (message !== previous!.messages[index]) update(message, 'message')
        })
      if (previous.tools !== state.tools)
        state.tools.forEach((tool, index) => {
          if (tool !== previous!.tools[index]) update(tool, 'tool')
        })
      if (changed.size) {
        const turns = new Map(view.turns)
        for (const id of changed) turns.set(id, buildTurn(groups.get(id)!))
        view = { ids: view.ids, turns }
      }
    }
    previous = state
    snapshots.set(state, view)
    return view
  }
}
