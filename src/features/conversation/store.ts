import { create } from 'zustand'
import type {
  ChatMessage,
  ComposerCommand,
  ContextUsage,
  ModelInfo,
  PermissionMode,
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
  setPiPermission,
  stopPi,
} from '@/lib/pi'
import { loadThinkingPreference, saveThinkingPreference } from './thinking-preference'
import { compactPi } from '@/lib/composer'
import { getResponseStatus } from './response-status'
import { modelKey } from './models'
import {
  rememberSession,
  findCachedSession,
  sessionDisplay,
  sessionKey,
  touchSession,
  type SessionCache,
  type ConversationViewState,
} from './session-cache'
import { reconcileTranscript } from './reconcile-transcript'
import { isCurrentSession } from '@/lib/session-preferences'

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
  contextUsage: ContextUsage | null
  permissionMode: PermissionMode
  models: ModelInfo[]
  thinkingLevel: string
  requestedThinkingLevel: string | null
  availableThinkingLevels: string[]
  settingsPending: 'model' | 'thinking' | 'permission' | null
  pendingSettings: {
    model?: ModelInfo | null
    thinkingLevel?: string
    permissionMode?: PermissionMode
  } | null
  activeRunId: string | null
  sequence: number
  error: string | null
  activity: string
  connectionStartedAt: number | null
  lastLocalActivityAt: number | null
  blocks: Record<string, Record<number, Block>>
  streamingBase: Record<string, { text: string; thinking: string }>
  runtimeMessageIds: Record<string, string>
  runtimeToolIds: Record<string, string>
}

interface ConversationState extends ConversationData {
  modelCatalog: ModelInfo[] | null
  commandCatalogs: ReadonlyMap<string, ComposerCommand[]>
  commandCatalogRevision: number
  invalidateCommandCatalogs: () => void
  backgroundSessions: ReadonlyMap<string, { data: ConversationData; projectPath: string | null }>
  sessionCache: SessionCache
  saveSessionView: (key: string, view: ConversationViewState) => void
  connectionTarget: { projectPath: string | null; sessionPath: string | null } | null
  connect: (
    projectPath: string | null,
    sessionPath?: string | null,
    options?: {
      force?: boolean
      sessionId?: string
      defaultModel?: ModelInfo | null
      defaultPermission?: PermissionMode
    },
  ) => Promise<void>
  disconnect: () => Promise<void>
  send: (message: string, attachmentIds?: string[]) => Promise<boolean>
  compact: (instructions?: string) => Promise<boolean>
  rewrite: (messageId: string, message?: string) => Promise<boolean>
  stop: () => Promise<void>
  changeModel: (model: ModelInfo) => Promise<void>
  changeThinkingLevel: (level: string) => Promise<void>
  changePermission: (mode: PermissionMode) => Promise<void>
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
  contextUsage: null,
  permissionMode: 'ask',
  models: [],
  thinkingLevel: 'off',
  requestedThinkingLevel: null,
  availableThinkingLevels: [],
  settingsPending: null,
  pendingSettings: null,
  activeRunId: null,
  sequence: 0,
  error: null,
  activity: '',
  connectionStartedAt: null,
  lastLocalActivityAt: null,
  blocks: {},
  streamingBase: {},
  runtimeMessageIds: {},
  runtimeToolIds: {},
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
    streamingBase: Object.fromEntries(
      snapshot.messages
        .filter((message) => message.status === 'streaming')
        .map((message) => [message.id, { text: message.text, thinking: message.thinking }]),
    ),
    tools: snapshot.tools ?? [],
    timeline:
      snapshot.timeline ??
      snapshot.messages.map((message) => ({ kind: 'message', id: message.id })),
    model: snapshot.model,
    contextUsage: snapshot.contextUsage ?? null,
    permissionMode: snapshot.permissionMode ?? 'ask',
    models: snapshot.models,
    thinkingLevel: snapshot.thinkingLevel ?? 'off',
    availableThinkingLevels: snapshot.availableThinkingLevels ?? [],
    status: snapshot.activeRunId ? 'running' : 'ready',
    activity:
      snapshot.activeRunId &&
      !snapshot.messages.some((message) => message.id === `${snapshot.activeRunId}-user`)
        ? '正在压缩上下文…'
        : '',
  }
}

// Settings acknowledgements must not replace the transcript or its scroll state.
function settingsFromSnapshot(snapshot: RuntimeSnapshot) {
  const current = useConversationStore.getState()
  return {
    permissionMode: snapshot.permissionMode ?? useConversationStore.getState().permissionMode,
    model: snapshot.model,
    contextUsage:
      snapshot.sequence < current.sequence ? current.contextUsage : (snapshot.contextUsage ?? null),
    models: snapshot.models,
    thinkingLevel: snapshot.thinkingLevel,
    availableThinkingLevels: snapshot.availableThinkingLevels,
    lastLocalActivityAt: Date.now(),
  }
}

export function thinkingCapabilitiesPending(state: ConversationData) {
  const selected = state.pendingSettings?.model
  return (
    state.status === 'connecting' ||
    Boolean(selected && (!state.model || modelKey(selected) !== modelKey(state.model)))
  )
}

export function reducePiEvent(state: ConversationData, event: PiEvent): ConversationData {
  if (event.instanceId !== state.instanceId || event.sequence <= state.sequence) return state
  let next = { ...state, sequence: event.sequence }
  if (event.runId && state.activeRunId && event.runId !== state.activeRunId) return next
  const data = event.data
  switch (data.type) {
    case 'context_usage_changed':
      next.contextUsage = data.usage
      break
    case 'transcript_replaced':
      next.messages = data.messages
      next.tools = data.tools
      next.timeline = data.timeline
      next.blocks = {}
      next.streamingBase = {}
      next.runtimeMessageIds = {}
      next.runtimeToolIds = {}
      next.lastLocalActivityAt = Date.now()
      break
    case 'run_started':
      next = {
        ...next,
        activeRunId: event.runId,
        status: state.status === 'stopping' ? 'stopping' : 'running',
        error: null,
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
      break
    case 'message_delta': {
      const blocks = { ...state.blocks[data.messageId] }
      const block = blocks[data.contentIndex] ?? { kind: data.kind, text: '' }
      blocks[data.contentIndex] = { ...block, text: block.text + data.delta }
      next.blocks = { ...state.blocks, [data.messageId]: blocks }
      const ordered = Object.entries(blocks).sort(([a], [b]) => Number(a) - Number(b))
      next.messages = state.messages.map((message) =>
        message.id === data.messageId
          ? {
              ...message,
              text:
                (state.streamingBase[data.messageId]?.text ?? '') +
                ordered
                  .filter(([, block]) => block.kind === 'text')
                  .map(([, b]) => b.text)
                  .join(''),
              thinking:
                (state.streamingBase[data.messageId]?.thinking ?? '') +
                ordered
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
      next.streamingBase = { ...state.streamingBase }
      delete next.streamingBase[data.message.id]
      break
    case 'tool_changed': {
      const exists = state.tools.some((tool) => tool.id === data.tool.id)
      next.tools = exists
        ? state.tools.map((tool) => (tool.id === data.tool.id ? data.tool : tool))
        : [...state.tools, data.tool]
      if (!exists) next.timeline = [...state.timeline, { kind: 'tool', id: data.tool.id }]
      break
    }
    case 'run_finished':
      next.blocks = {}
      next.streamingBase = {}
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
      next.streamingBase = {}
      next.status = 'disconnected'
      next.instanceId = null
      next.activeRunId = null
      next.settingsPending = null
      next.pendingSettings = null
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
  if (['run_started', 'message_started', 'message_delta', 'tool_changed'].includes(data.type)) {
    // Message completion precedes tool/run completion. Keep the current phase
    // until that next event instead of briefly reverting to waiting for output.
    next.activity =
      next.status === 'stopping'
        ? '正在停止…'
        : getResponseStatus(
            next.messages.at(-1),
            next.tools.filter((tool) => tool.runId === next.activeRunId),
          )
  }
  return next
}

// Apply all deltas received in one frame together; terminal events remain ordered.
let queued: PiEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let connection = 0
let settingsTask: { connection: number; instanceId: string; promise: Promise<void> } | null = null

function applyPendingSettings(): Promise<void> {
  const get = useConversationStore.getState
  const set = useConversationStore.setState
  const { instanceId, status, readOnly, pendingSettings } = get()
  if (!instanceId || status !== 'ready' || readOnly || !pendingSettings) return Promise.resolve()
  if (settingsTask?.connection === connection && settingsTask.instanceId === instanceId)
    return settingsTask.promise

  const task = { connection, instanceId, promise: Promise.resolve() }
  settingsTask = task
  const current = () =>
    task.connection === connection && get().instanceId === instanceId && get().status === 'ready'
  task.promise = (async () => {
    let appliedModel: ModelInfo | null = null
    try {
      while (current() && get().pendingSettings) {
        const selection = get().pendingSettings!
        try {
          if (selection.permissionMode) {
            set({ settingsPending: 'permission' })
            const snapshot = await setPiPermission(instanceId, selection.permissionMode)
            if (!current()) return
            set(settingsFromSnapshot(snapshot))
            if (get().pendingSettings !== selection) continue
          }
          if (
            selection.model &&
            (!appliedModel || modelKey(selection.model) !== modelKey(appliedModel))
          ) {
            set({ settingsPending: 'model' })
            const snapshot = await setPiModel(
              instanceId,
              selection.model.provider,
              selection.model.id,
            )
            if (!current()) return
            appliedModel = selection.model
            set(settingsFromSnapshot(snapshot))
            if (get().pendingSettings !== selection) continue
          }
          if (selection.thinkingLevel === undefined) {
            set({ pendingSettings: null, settingsPending: null })
            continue
          }
          const level = get().availableThinkingLevels.includes(selection.thinkingLevel)
            ? selection.thinkingLevel
            : 'default'
          set({ settingsPending: 'thinking' })
          const snapshot = await setPiThinkingLevel(instanceId, level)
          if (!current()) return
          set(settingsFromSnapshot(snapshot))
          // A newer choice supersedes this acknowledgement, including its saved preference.
          if (get().pendingSettings !== selection) continue
          await saveThinkingPreference(level).catch((reason: unknown) => {
            if (current()) set({ error: `无法保存思考偏好：${String(reason)}` })
          })
          if (!current()) return
          if (get().pendingSettings !== selection) continue
          set({ requestedThinkingLevel: level, pendingSettings: null, settingsPending: null })
        } catch (reason) {
          if (!current()) return
          if (get().pendingSettings !== selection) continue
          set({ pendingSettings: null, settingsPending: null, error: String(reason) })
        }
      }
    } finally {
      if (settingsTask === task) settingsTask = null
    }
  })()
  return task.promise
}

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

function flushEvents() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  const events = queued
  queued = []
  if (events.length) useConversationStore.getState().receive(events)
}

const running = (state: Pick<ConversationData, 'status'>) =>
  ['running', 'stopping'].includes(state.status)

export function isSessionBusy(
  session: { id: string; path: string },
  state: Pick<
    ConversationState,
    'status' | 'sessionId' | 'sessionFile' | 'backgroundSessions'
  > = useConversationStore.getState(),
) {
  return (
    (running(state) && isCurrentSession(session, state)) ||
    [...state.backgroundSessions.values()].some(
      ({ data }) => running(data) && isCurrentSession(session, data),
    )
  )
}

export function isProjectBusy(
  path: string,
  state: Pick<
    ConversationState,
    'status' | 'connectionTarget' | 'backgroundSessions'
  > = useConversationStore.getState(),
) {
  return (
    (running(state) && sessionKey(state.connectionTarget?.projectPath) === sessionKey(path)) ||
    [...state.backgroundSessions.values()].some(
      ({ data, projectPath }) => running(data) && sessionKey(projectPath) === sessionKey(path),
    )
  )
}

function conversationData(state: ConversationData): ConversationData {
  // Do not retain store methods or maps of previous sessions inside a live entry.
  return Object.fromEntries(
    Object.keys(emptyConversation).map((key) => [key, state[key as keyof ConversationData]]),
  ) as unknown as ConversationData
}

function updateInstance(instanceId: string, update: (state: ConversationData) => ConversationData) {
  useConversationStore.setState((state) => {
    if (state.instanceId === instanceId) return update(state)
    const entry = state.backgroundSessions.get(instanceId)
    if (!entry) return state
    const data = update(entry.data)
    const backgroundSessions = new Map(state.backgroundSessions)
    if (running(data)) backgroundSessions.set(instanceId, { ...entry, data })
    else backgroundSessions.delete(instanceId)
    return { backgroundSessions, sessionCache: rememberSession(state.sessionCache, data) }
  })
  // A rejected request can end locally without a terminal runtime event.
  void applyPendingSettings()
}

export function canReuseNewConversation(state: ConversationState, projectPath: string | null) {
  return Boolean(
    state.connectionTarget &&
    state.connectionTarget.sessionPath === null &&
    sessionKey(state.connectionTarget.projectPath) === sessionKey(projectPath) &&
    (state.status === 'connecting' || (state.status === 'ready' && state.instanceId)) &&
    !state.readOnly &&
    !state.error &&
    !state.messages.length &&
    !state.tools.length &&
    !state.timeline.length,
  )
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  ...emptyConversation,
  modelCatalog: null,
  commandCatalogs: new Map(),
  commandCatalogRevision: 0,
  invalidateCommandCatalogs: () =>
    set((state) => ({
      commandCatalogs: new Map(),
      commandCatalogRevision: state.commandCatalogRevision + 1,
    })),
  backgroundSessions: new Map(),
  sessionCache: new Map(),
  saveSessionView: (key, view) =>
    set((state) => {
      const entry = state.sessionCache.get(key)
      if (!entry) return state
      const sessionCache = new Map(state.sessionCache)
      sessionCache.set(key, { ...entry, view })
      return { sessionCache }
    }),
  connectionTarget: null,
  receive: (events) => {
    set((state) => {
      let next = state
      for (const event of events) {
        if (event.instanceId === next.instanceId)
          next = reducePiEvent(next, event) as ConversationState
        else {
          const entry = next.backgroundSessions.get(event.instanceId)
          if (!entry) continue
          const data = reducePiEvent(entry.data, event)
          if (data === entry.data) continue
          const backgroundSessions = new Map(next.backgroundSessions)
          if (running(data)) backgroundSessions.set(event.instanceId, { ...entry, data })
          else backgroundSessions.delete(event.instanceId)
          next = {
            ...next,
            backgroundSessions,
            sessionCache: rememberSession(next.sessionCache, data),
          }
        }
      }
      return next
    })
    // Choices made during a reply are applied only after its terminal event.
    // The current run, including any outstanding approvals, keeps its settings.
    void applyPendingSettings()
  },
  connect: async (projectPath, sessionPath, options) => {
    flushEvents()
    const current = get()
    const key = sessionKey(sessionPath)
    const sameSession = Boolean(
      key &&
      (options?.sessionId
        ? current.sessionId === options.sessionId
        : key === sessionKey(current.sessionFile)),
    )
    if (!options?.force && !key && canReuseNewConversation(current, projectPath)) return
    if (
      !options?.force &&
      sameSession &&
      ['ready', 'connecting', 'running', 'stopping'].includes(current.status)
    )
      return
    const request = ++connection
    const requestedThinkingLevel = current.requestedThinkingLevel ?? loadThinkingPreference()
    // Only restore display data. A cached transcript never revives a runtime or approval.
    const previousCache = key
      ? findCachedSession(current.sessionCache, options?.sessionId, sessionPath)
      : undefined
    let sessionCache = rememberSession(current.sessionCache, current)
    const found = key
      ? (findCachedSession(sessionCache, options?.sessionId, sessionPath) ?? previousCache)
      : undefined
    const cached = found?.[1]
    const live = [...current.backgroundSessions.values()].find(({ data }) =>
      isCurrentSession({ id: options?.sessionId ?? '', path: sessionPath ?? '' }, data),
    )?.data
    const display =
      live ?? (sameSession && current.messages.length ? sessionDisplay(current) : cached?.display)
    const settings =
      !key && current.model && ['ready', 'connecting'].includes(current.status) && !current.readOnly
        ? {
            model:
              options && 'defaultModel' in options ? (options.defaultModel ?? null) : current.model,
            models: current.models,
            thinkingLevel: current.thinkingLevel,
            availableThinkingLevels: current.availableThinkingLevels,
          }
        : undefined
    if (found) sessionCache = touchSession(sessionCache, found[0], found[1])
    let restorePreference: Promise<void> | undefined
    const backgroundSessions = new Map(current.backgroundSessions)
    if (current.instanceId && running(current))
      backgroundSessions.set(current.instanceId, {
        data: conversationData(current),
        projectPath: current.connectionTarget?.projectPath ?? null,
      })
    set({
      ...emptyConversation,
      ...display,
      // Displaying a retained stream does not authorize actions before subscribe.
      instanceId: null,
      ...settings,
      ...(!key ? { permissionMode: options?.defaultPermission ?? 'ask' } : {}),
      // The configured catalog remains usable even before an uncached session opens.
      models: current.models.length ? current.models : (display?.models ?? []),
      sessionCache,
      backgroundSessions,
      requestedThinkingLevel,
      connectionTarget: { projectPath, sessionPath: sessionPath ?? null },
      sessionFile: sessionPath ?? null,
      sessionId: options?.sessionId ?? display?.sessionId ?? null,
      status: 'connecting',
      connectionStartedAt: Date.now(),
      activity: '正在连接…',
    })
    try {
      await connectPi(
        projectPath,
        (snapshot) => {
          if (request !== connection) return
          flushEvents()
          const pendingSettings = snapshot.readOnly
            ? null
            : snapshot.activeRunId
              ? get().pendingSettings
              : {
                  model: null,
                  thinkingLevel: requestedThinkingLevel,
                  ...get().pendingSettings,
                }
          const data = {
            ...fromSnapshot(snapshot),
            ...(get().sessionId === snapshot.sessionId && !snapshot.activeRunId
              ? reconcileTranscript(get(), snapshot)
              : {}),
            requestedThinkingLevel,
            pendingSettings,
            settingsPending:
              pendingSettings && !snapshot.activeRunId
                ? pendingSettings.permissionMode
                  ? ('permission' as const)
                  : pendingSettings.model
                    ? ('model' as const)
                    : ('thinking' as const)
                : null,
            lastLocalActivityAt: get().lastLocalActivityAt,
          }
          const backgroundSessions = new Map(get().backgroundSessions)
          backgroundSessions.delete(snapshot.instanceId)
          set({
            ...data,
            backgroundSessions,
            sessionCache: rememberSession(get().sessionCache, data),
          })
          restorePreference = applyPendingSettings()
        },
        enqueue,
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
          pendingSettings: null,
        })
    }
  },
  disconnect: async () => {
    const request = ++connection
    queued = []
    set({
      backgroundSessions: new Map(),
      ...sessionDisplay(get()),
      instanceId: null,
      status: 'disconnected',
      activeRunId: null,
      sequence: 0,
      blocks: {},
      runtimeMessageIds: {},
      runtimeToolIds: {},
      settingsPending: null,
      pendingSettings: null,
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
      updateInstance(instanceId, (state) =>
        state.activeRunId === runId
          ? {
              ...state,
              status: 'ready',
              activeRunId: null,
              error: String(reason),
              activity: '',
              lastLocalActivityAt: Date.now(),
            }
          : state,
      )
      return false
    }
  },
  compact: async (instructions = '') => {
    const { instanceId, status, readOnly, settingsPending } = get()
    if (!instanceId || status !== 'ready' || readOnly || settingsPending) return false
    const runId = crypto.randomUUID()
    set({ status: 'running', activeRunId: runId, error: null, activity: '正在压缩上下文…' })
    try {
      await compactPi(instanceId, runId, instructions)
      return true
    } catch (reason) {
      updateInstance(instanceId, (state) =>
        state.activeRunId === runId
          ? { ...state, status: 'ready', activeRunId: null, error: String(reason), activity: '' }
          : state,
      )
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
      updateInstance(instanceId, (state) => ({ ...state, error: String(reason) }))
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
      await rewritePiMessage(
        instanceId,
        runId,
        get().runtimeMessageIds[messageId] ?? messageId,
        message,
      )
      return true
    } catch (reason) {
      updateInstance(instanceId, (state) =>
        state.activeRunId === runId
          ? { ...state, status: 'ready', activeRunId: null, error: String(reason), activity: '' }
          : state,
      )
      return false
    }
  },
  changeModel: async (model) => {
    const { instanceId, status, readOnly, pendingSettings, requestedThinkingLevel } = get()
    if (status === 'disconnected' || readOnly || (status !== 'connecting' && !instanceId)) return
    set({
      pendingSettings: {
        ...(pendingSettings?.permissionMode
          ? { permissionMode: pendingSettings.permissionMode }
          : {}),
        model,
        thinkingLevel: pendingSettings?.thinkingLevel ?? requestedThinkingLevel ?? 'default',
      },
      settingsPending: status === 'ready' ? 'model' : null,
      error: null,
    })
    await applyPendingSettings()
  },
  changeThinkingLevel: async (level) => {
    const state = get()
    const { instanceId, status, readOnly, pendingSettings } = state
    if (status === 'disconnected' || readOnly || (status !== 'connecting' && !instanceId)) return
    if (
      level !== 'default' &&
      !thinkingCapabilitiesPending(state) &&
      !state.availableThinkingLevels.includes(level)
    )
      return
    set({
      pendingSettings: {
        ...(pendingSettings?.permissionMode
          ? { permissionMode: pendingSettings.permissionMode }
          : {}),
        model: pendingSettings?.model ?? null,
        thinkingLevel: level,
      },
      settingsPending: status === 'ready' ? (pendingSettings?.model ? 'model' : 'thinking') : null,
      error: null,
    })
    await applyPendingSettings()
  },
  changePermission: async (mode) => {
    const state = get()
    if (
      state.status === 'disconnected' ||
      state.readOnly ||
      (state.status !== 'connecting' && !state.instanceId)
    )
      return
    set({
      pendingSettings: { ...state.pendingSettings, permissionMode: mode },
      settingsPending: state.status === 'ready' ? 'permission' : null,
      error: null,
    })
    await applyPendingSettings()
  },
}))
