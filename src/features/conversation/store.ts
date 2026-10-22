import { create } from 'zustand'
import type {
  ChatMessage,
  ModelInfo,
  PiEvent,
  RuntimeSnapshot,
  ToolCall,
  TimelineEntry,
} from '@/lib/generated/pi'
import {
  connectPi,
  disconnectPi,
  sendPiMessage,
  rewritePiMessage,
  setPiModel,
  setPiThinkingLevel,
  stopPi,
} from '@/lib/pi'
import { loadThinkingPreference, saveThinkingPreference } from './thinking-preference'
import {
  rememberSession,
  sessionDisplay,
  sessionKey,
  touchSession,
  type SessionCache,
} from './session-cache'

type Status = 'disconnected' | 'connecting' | 'ready' | 'running' | 'stopping'
type Block = { kind: string; text: string }

export interface ConversationData {
  instanceId: string | null
  sessionId: string | null
  sessionFile: string | null
  readOnly: string | null
  status: Status
  messages: ChatMessage[]
  tools: ToolCall[]
  timeline: TimelineEntry[]
  model: ModelInfo | null
  models: ModelInfo[]
  thinkingLevel: string
  requestedThinkingLevel: string | null
  availableThinkingLevels: string[]
  settingsPending: 'model' | 'thinking' | null
  activeRunId: string | null
  sequence: number
  error: string | null
  activity: string
  connectionStartedAt: number | null
  lastLocalActivityAt: number | null
  blocks: Record<string, Record<number, Block>>
}

interface ConversationState extends ConversationData {
  sessionCache: SessionCache
  connect: (
    projectPath: string | null,
    sessionPath?: string | null,
    options?: { force?: boolean },
  ) => Promise<void>
  disconnect: () => Promise<void>
  send: (message: string, attachmentIds?: string[]) => Promise<boolean>
  rewrite: (messageId: string, message?: string) => Promise<boolean>
  stop: () => Promise<void>
  changeModel: (model: ModelInfo) => Promise<void>
  changeThinkingLevel: (level: string) => Promise<void>
  receive: (events: PiEvent[]) => void
}

export const emptyConversation: ConversationData = {
  instanceId: null,
  sessionId: null,
  sessionFile: null,
  readOnly: null,
  status: 'disconnected',
  messages: [],
  tools: [],
  timeline: [],
  model: null,
  models: [],
  thinkingLevel: 'off',
  requestedThinkingLevel: null,
  availableThinkingLevels: [],
  settingsPending: null,
  activeRunId: null,
  sequence: 0,
  error: null,
  activity: '',
  connectionStartedAt: null,
  lastLocalActivityAt: null,
  blocks: {},
}

function fromSnapshot(snapshot: RuntimeSnapshot): ConversationData {
  return {
    ...emptyConversation,
    instanceId: snapshot.instanceId,
    sessionId: snapshot.sessionId,
    sessionFile: snapshot.sessionFile,
    readOnly: snapshot.readOnly,
    sequence: snapshot.sequence,
    activeRunId: snapshot.activeRunId,
    messages: snapshot.messages,
    tools: snapshot.tools ?? [],
    timeline:
      snapshot.timeline ??
      snapshot.messages.map((message) => ({ kind: 'message', id: message.id })),
    model: snapshot.model,
    models: snapshot.models,
    thinkingLevel: snapshot.thinkingLevel ?? 'off',
    availableThinkingLevels: snapshot.availableThinkingLevels ?? [],
    status: snapshot.activeRunId ? 'running' : 'ready',
  }
}

// Settings acknowledgements must not replace the transcript or its scroll state.
function settingsFromSnapshot(snapshot: RuntimeSnapshot) {
  return {
    model: snapshot.model,
    models: snapshot.models,
    thinkingLevel: snapshot.thinkingLevel,
    availableThinkingLevels: snapshot.availableThinkingLevels,
  }
}

export function reducePiEvent(state: ConversationData, event: PiEvent): ConversationData {
  if (event.instanceId !== state.instanceId || event.sequence <= state.sequence) return state
  let next = { ...state, sequence: event.sequence }
  if (event.runId && state.activeRunId && event.runId !== state.activeRunId) return next
  const data = event.data
  switch (data.type) {
    case 'transcript_replaced':
      next.messages = data.messages
      next.tools = data.tools
      next.timeline = data.timeline
      next.blocks = {}
      next.lastLocalActivityAt = Date.now()
      break
    case 'run_started':
      next = {
        ...next,
        activeRunId: event.runId,
        status: state.status === 'stopping' ? 'stopping' : 'running',
        error: null,
        activity: state.status === 'stopping' ? '正在停止…' : '正在等待回复…',
        messages: [
          ...state.messages,
          { ...data.message, startedAt: data.message.startedAt ?? Date.now() },
        ],
        timeline: [...state.timeline, { kind: 'message', id: data.message.id }],
      }
      break
    case 'message_started':
      next.messages = [...state.messages, data.message]
      next.timeline = [...state.timeline, { kind: 'message', id: data.message.id }]
      next.blocks = { ...state.blocks, [data.message.id]: {} }
      next.activity = state.status === 'stopping' ? '正在停止…' : '正在生成…'
      break
    case 'message_delta': {
      const blocks = { ...state.blocks[data.messageId] }
      const block = blocks[data.contentIndex] ?? { kind: data.kind, text: '' }
      blocks[data.contentIndex] = { ...block, text: block.text + data.delta }
      next.blocks = { ...state.blocks, [data.messageId]: blocks }
      next.activity = state.status === 'stopping' ? '正在停止…' : '正在生成…'
      const ordered = Object.entries(blocks).sort(([a], [b]) => Number(a) - Number(b))
      next.messages = state.messages.map((message) =>
        message.id === data.messageId
          ? {
              ...message,
              text: ordered
                .filter(([, block]) => block.kind === 'text')
                .map(([, b]) => b.text)
                .join(''),
              thinking: ordered
                .filter(([, block]) => block.kind === 'thinking')
                .map(([, b]) => b.text)
                .join(''),
            }
          : message,
      )
      break
    }
    case 'message_completed':
      next.messages = state.messages.map((m) => (m.id === data.message.id ? data.message : m))
      next.blocks = { ...state.blocks }
      delete next.blocks[data.message.id]
      break
    case 'tool_changed': {
      const exists = state.tools.some((tool) => tool.id === data.tool.id)
      next.tools = exists
        ? state.tools.map((tool) => (tool.id === data.tool.id ? data.tool : tool))
        : [...state.tools, data.tool]
      if (!exists) next.timeline = [...state.timeline, { kind: 'tool', id: data.tool.id }]
      next.activity =
        state.status === 'stopping'
          ? '正在停止…'
          : data.tool.status === 'awaiting_approval'
            ? '等待工具调用确认…'
            : data.tool.status === 'running'
              ? '正在执行工具…'
              : '正在等待 Pi…'
      break
    }
    case 'run_finished':
      next.blocks = {}
      next.status = 'ready'
      next.activeRunId = null
      next.activity = data.status === 'cancelled' ? '已停止生成' : ''
      next.error = data.error
      // Pi persists this run's messages before it emits the terminal event.
      next.lastLocalActivityAt = Math.max(
        state.lastLocalActivityAt ?? 0,
        data.finishedAt ?? Date.now(),
      )
      next.messages = state.messages.map((m) =>
        m.id === `${event.runId}-user`
          ? { ...m, finishedAt: data.finishedAt ?? Date.now() }
          : m.status === 'streaming'
            ? { ...m, status: data.status, error: data.error }
            : m,
      )
      next.tools = state.tools.map((tool) =>
        ['awaiting_approval', 'queued', 'running'].includes(tool.status)
          ? {
              ...tool,
              approvalId: null,
              status: data.status === 'cancelled' ? 'cancelled' : 'interrupted',
            }
          : tool,
      )
      break
    case 'status':
      next.activity = data.text
      break
    case 'disconnected':
      next.blocks = {}
      next.status = 'disconnected'
      next.instanceId = null
      next.activeRunId = null
      next.settingsPending = null
      next.error = data.error
      next.activity = ''
      next.messages = state.messages.map((m) =>
        m.id === `${state.activeRunId}-user`
          ? { ...m, finishedAt: Date.now() }
          : m.status === 'streaming'
            ? { ...m, status: 'failed' }
            : m,
      )
      next.tools = state.tools.map((tool) =>
        ['awaiting_approval', 'queued', 'running'].includes(tool.status)
          ? { ...tool, approvalId: null, status: 'interrupted' }
          : tool,
      )
  }
  return next
}

// Apply all deltas received in one frame together; terminal events remain ordered.
let queued: PiEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let connection = 0
function enqueue(event: PiEvent) {
  queued.push(event)
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    const events = queued
    queued = []
    flushTimer = null
    useConversationStore.getState().receive(events)
  }, 16)
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  ...emptyConversation,
  sessionCache: new Map(),
  receive: (events) => set((state) => events.reduce(reducePiEvent, state)),
  connect: async (projectPath, sessionPath, options) => {
    const current = get()
    if (['running', 'stopping'].includes(current.status)) return
    const key = sessionKey(sessionPath)
    if (
      !options?.force &&
      key &&
      key === sessionKey(current.sessionFile) &&
      ['ready', 'connecting'].includes(current.status)
    )
      return
    const request = ++connection
    const requestedThinkingLevel = current.requestedThinkingLevel ?? loadThinkingPreference()
    // Only restore display data. A cached transcript never revives a runtime or approval.
    const previousCache = key ? current.sessionCache.get(key) : undefined
    let sessionCache = rememberSession(current.sessionCache, current)
    const cached = key ? (sessionCache.get(key) ?? previousCache) : undefined
    const display =
      key && key === sessionKey(current.sessionFile) && current.messages.length
        ? sessionDisplay(current)
        : cached?.display
    if (key && cached) sessionCache = touchSession(sessionCache, key, cached)
    let restorePreference: Promise<void> | undefined
    queued = []
    set({
      ...emptyConversation,
      ...display,
      sessionCache,
      requestedThinkingLevel,
      sessionFile: sessionPath ?? null,
      status: 'connecting',
      connectionStartedAt: Date.now(),
      activity: '正在连接…',
    })
    try {
      await connectPi(
        projectPath,
        (snapshot) => {
          if (request !== connection) return
          const data = {
            ...fromSnapshot(snapshot),
            requestedThinkingLevel,
            lastLocalActivityAt: get().lastLocalActivityAt,
          }
          set({ ...data, sessionCache: rememberSession(get().sessionCache, data) })
          if (!snapshot.readOnly && !snapshot.activeRunId) {
            const level =
              requestedThinkingLevel === 'default' ||
              snapshot.availableThinkingLevels.includes(requestedThinkingLevel)
                ? requestedThinkingLevel
                : 'default'
            restorePreference = get().changeThinkingLevel(level)
          }
        },
        (event) => {
          if (request === connection) enqueue(event)
        },
        sessionPath,
      )
      await restorePreference
    } catch (reason) {
      if (request === connection)
        set({
          status: 'disconnected',
          instanceId: null,
          error: String(reason),
          activity: '',
          connectionStartedAt: null,
          settingsPending: null,
        })
    }
  },
  disconnect: async () => {
    const request = ++connection
    queued = []
    set({
      ...sessionDisplay(get()),
      instanceId: null,
      status: 'disconnected',
      activeRunId: null,
      sequence: 0,
      blocks: {},
      settingsPending: null,
      activity: '',
      error: null,
      connectionStartedAt: null,
    })
    try {
      await disconnectPi()
    } catch (reason) {
      if (request === connection) set({ error: String(reason) })
    }
  },
  send: async (message, attachmentIds = []) => {
    const { instanceId, status, readOnly, settingsPending } = get()
    if (
      !instanceId ||
      status !== 'ready' ||
      readOnly ||
      settingsPending ||
      (!message.trim() && !attachmentIds.length)
    )
      return false
    const runId = crypto.randomUUID()
    set({ status: 'running', activeRunId: runId, error: null, activity: '正在发送…' })
    try {
      await sendPiMessage(instanceId, runId, message, attachmentIds)
      return true
    } catch (reason) {
      if (get().instanceId === instanceId && get().activeRunId === runId) {
        set({
          status: 'ready',
          activeRunId: null,
          error: String(reason),
          activity: '',
          lastLocalActivityAt: Date.now(),
        })
      }
      return false
    }
  },
  stop: async () => {
    const { instanceId, status } = get()
    if (!instanceId || status !== 'running') return
    set({ status: 'stopping', activity: '正在停止…' })
    try {
      await stopPi(instanceId)
    } catch (reason) {
      set({ error: String(reason) })
    }
  },
  rewrite: async (messageId, message) => {
    const { instanceId, status, readOnly, settingsPending, messages } = get()
    const original = messages.find((item) => item.id === messageId && item.role === 'user')
    if (
      !instanceId ||
      status !== 'ready' ||
      readOnly ||
      settingsPending ||
      !original ||
      (message !== undefined && !message.trim() && !original.attachments?.length)
    )
      return false
    const runId = crypto.randomUUID()
    set({
      status: 'running',
      activeRunId: runId,
      error: null,
      activity: message === undefined ? '正在重新回答…' : '正在发送修改…',
    })
    try {
      await rewritePiMessage(instanceId, runId, messageId, message)
      return true
    } catch (reason) {
      if (get().instanceId === instanceId && get().activeRunId === runId)
        set({ status: 'ready', activeRunId: null, error: String(reason), activity: '' })
      return false
    }
  },
  changeModel: async (model) => {
    const { instanceId, status, readOnly, settingsPending, requestedThinkingLevel } = get()
    if (!instanceId || status !== 'ready' || readOnly || settingsPending) return
    const request = connection
    const current = () => request === connection && get().instanceId === instanceId
    set({ settingsPending: 'model', error: null })
    try {
      const snapshot = await setPiModel(instanceId, model.provider, model.id)
      if (!current()) return
      set(settingsFromSnapshot(snapshot))
      const level =
        requestedThinkingLevel && snapshot.availableThinkingLevels.includes(requestedThinkingLevel)
          ? requestedThinkingLevel
          : 'default'
      const thinking = await setPiThinkingLevel(instanceId, level)
      if (!current()) return
      saveThinkingPreference(level)
      set({
        ...settingsFromSnapshot(thinking),
        requestedThinkingLevel: level,
        settingsPending: null,
      })
    } catch (reason) {
      if (current()) set({ settingsPending: null, error: String(reason) })
    }
  },
  changeThinkingLevel: async (level) => {
    const { instanceId, status, readOnly, settingsPending, requestedThinkingLevel } = get()
    if (!instanceId || status !== 'ready' || readOnly || settingsPending) return
    if (level !== 'default' && !get().availableThinkingLevels.includes(level)) return
    const request = connection
    const current = () => request === connection && get().instanceId === instanceId
    set({ settingsPending: 'thinking', requestedThinkingLevel: level, error: null })
    try {
      const snapshot = await setPiThinkingLevel(instanceId, level)
      if (!current()) return
      saveThinkingPreference(level)
      set({ ...settingsFromSnapshot(snapshot), settingsPending: null })
    } catch (reason) {
      if (current()) set({ settingsPending: null, requestedThinkingLevel, error: String(reason) })
    }
  },
}))
