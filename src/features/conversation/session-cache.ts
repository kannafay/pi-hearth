import type { ConversationData } from './store'
import type { VirtualItem } from '@tanstack/react-virtual'
import { sessionKey } from '@/lib/session-preferences'

export { sessionKey } from '@/lib/session-preferences'

type SessionDisplay = Pick<
  ConversationData,
  | 'sessionId'
  | 'readOnly'
  | 'messages'
  | 'tools'
  | 'timeline'
  | 'model'
  | 'contextUsage'
  | 'permissionMode'
  | 'models'
  | 'thinkingLevel'
  | 'availableThinkingLevels'
  | 'pendingSettings'
  | 'lastLocalActivityAt'
>
export interface ConversationViewState {
  offset?: number
  atEnd: boolean
  measurements: VirtualItem[]
  localState: Map<string, unknown>
}
type CachedSession = {
  display: SessionDisplay
  size: number
  paths: string[]
  view?: ConversationViewState
}
export type SessionCache = ReadonlyMap<string, CachedSession>

export function relocateSessionCache(
  cache: SessionCache,
  relocate: (path: string) => string,
): SessionCache {
  return new Map(
    [...cache].map(([key, entry]) => [
      key.startsWith('path:') ? `path:${sessionKey(relocate(key.slice(5)))}` : key,
      { ...entry, paths: entry.paths.map((path) => sessionKey(relocate(path))!) },
    ]),
  )
}

const MAX_SESSIONS = 8
// Bound retained text and inline media as well as the number of conversations.
const MAX_CHARACTERS = 16_000_000

export function sessionCacheKey(state: { sessionId?: string | null; sessionFile: string | null }) {
  return state.sessionId
    ? `id:${state.sessionId}`
    : state.sessionFile
      ? `path:${sessionKey(state.sessionFile)}`
      : null
}

export function findCachedSession(
  cache: SessionCache,
  sessionId?: string | null,
  path?: string | null,
) {
  if (sessionId) {
    const key = `id:${sessionId}`
    const entry = cache.get(key)
    if (entry) return [key, entry] as const
    return [...cache].find(([, entry]) => entry.display.sessionId === sessionId)
  }
  const key = sessionKey(path)
  return key ? [...cache].find(([, entry]) => entry.paths.includes(key)) : undefined
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
    contextUsage: state.contextUsage,
    permissionMode: state.permissionMode,
    models: state.models,
    thinkingLevel: state.thinkingLevel,
    availableThinkingLevels: state.availableThinkingLevels,
    // Retain deferred choices, not an in-flight write belonging to an old connection.
    pendingSettings: state.settingsPending ? null : state.pendingSettings,
    lastLocalActivityAt: state.lastLocalActivityAt,
  }
}

export function rememberSession(cache: SessionCache, state: ConversationData): SessionCache {
  const key = sessionCacheKey(state)
  if (
    !key ||
    !['ready', 'disconnected'].includes(state.status) ||
    (!state.instanceId && !state.messages.length)
  )
    return cache

  const display = sessionDisplay(state)
  const previous = findCachedSession(cache, state.sessionId, state.sessionFile)
  const paths = new Set(previous?.[1].paths)
  const path = sessionKey(state.sessionFile)
  if (path) paths.add(path)
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
  const next = new Map(cache)
  if (previous && previous[0] !== key) next.delete(previous[0])
  return touchSession(next, key, { display, size, paths: [...paths], view: previous?.[1].view })
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
