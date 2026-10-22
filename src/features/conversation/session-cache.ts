import type { ConversationData } from './store'

type SessionDisplay = Pick<
  ConversationData,
  | 'sessionId'
  | 'readOnly'
  | 'messages'
  | 'tools'
  | 'timeline'
  | 'model'
  | 'models'
  | 'thinkingLevel'
  | 'availableThinkingLevels'
  | 'lastLocalActivityAt'
>
type CachedSession = { display: SessionDisplay; size: number }
export type SessionCache = ReadonlyMap<string, CachedSession>

const MAX_SESSIONS = 8
// Bound retained text and inline media as well as the number of conversations.
const MAX_CHARACTERS = 16_000_000

export function sessionKey(path: string | null | undefined) {
  return path?.replaceAll('\\', '/').toLowerCase() ?? null
}

export function sessionDisplay(state: ConversationData): SessionDisplay {
  return {
    sessionId: state.sessionId,
    readOnly: state.readOnly,
    messages: state.messages.map((message) =>
      message.status === 'streaming' ? { ...message, status: 'failed' } : message,
    ),
    tools: state.tools.map((tool) =>
      ['awaiting_approval', 'queued', 'running'].includes(tool.status)
        ? { ...tool, approvalId: null, status: 'interrupted' }
        : tool,
    ),
    timeline: state.timeline,
    model: state.model,
    models: state.models,
    thinkingLevel: state.thinkingLevel,
    availableThinkingLevels: state.availableThinkingLevels,
    lastLocalActivityAt: state.lastLocalActivityAt,
  }
}

export function rememberSession(cache: SessionCache, state: ConversationData): SessionCache {
  const key = sessionKey(state.sessionFile)
  if (
    !key ||
    !['ready', 'disconnected'].includes(state.status) ||
    (!state.instanceId && !state.messages.length)
  )
    return cache

  const display = sessionDisplay(state)
  const size =
    state.messages.reduce(
      (sum, message) =>
        sum +
        256 +
        message.text.length +
        message.thinking.length +
        (message.attachments ?? []).reduce(
          (total, file) => total + (file.preview?.length ?? 0) + (file.text?.length ?? 0) + 256,
          0,
        ),
      0,
    ) + state.tools.reduce((sum, tool) => sum + tool.arguments.length + tool.output.length + 512, 0)
  return touchSession(cache, key, { display, size })
}

export function touchSession(cache: SessionCache, key: string, entry: CachedSession): SessionCache {
  const next = new Map(cache)
  next.delete(key)
  if (entry.size <= MAX_CHARACTERS) next.set(key, entry)
  let size = [...next.values()].reduce((sum, session) => sum + session.size, 0)
  for (const [path, session] of next) {
    if (next.size <= MAX_SESSIONS && size <= MAX_CHARACTERS) break
    next.delete(path)
    size -= session.size
  }
  return next
}
