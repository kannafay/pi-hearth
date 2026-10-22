import { beforeEach, expect, test, vi } from 'vitest'
import {
  emptyConversation,
  reducePiEvent,
  useConversationStore,
  type ConversationData,
} from './store'
import type { ChatMessage, EventData, PiEvent, RuntimeSnapshot, ToolCall } from '@/lib/generated/pi'
import { connectPi, sendPiMessage, setPiModel, setPiThinkingLevel, stopPi } from '@/lib/pi'
import { loadThinkingPreference, saveThinkingPreference } from './thinking-preference'

vi.mock('@/lib/pi', () => ({
  connectPi: vi.fn(),
  disconnectPi: vi.fn(),
  sendPiMessage: vi.fn(),
  stopPi: vi.fn(),
  setPiModel: vi.fn(),
  setPiThinkingLevel: vi.fn(),
}))

const message: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  text: '',
  thinking: '',
  status: 'streaming',
  error: null,
}
const snapshot: RuntimeSnapshot = {
  instanceId: 'pi-1',
  projectPath: 'project',
  sessionId: 'session-1',
  sessionFile: null,
  readOnly: null,
  model: { provider: 'test', id: 'chat', name: 'Chat' },
  models: [],
  thinkingLevel: 'medium',
  availableThinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  messages: [],
  tools: [],
  timeline: [],
  activeRunId: null,
  sequence: 0,
}
function event(
  sequence: number,
  data: EventData,
  instanceId = 'pi-1',
  runId: string | null = 'run-1',
): PiEvent {
  return { instanceId, projectPath: 'project', sessionId: 'session-1', runId, sequence, data }
}

beforeEach(() => {
  localStorage.clear()
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  vi.clearAllMocks()
  useConversationStore.setState({ availableThinkingLevels: snapshot.availableThinkingLevels })
  vi.mocked(setPiThinkingLevel).mockResolvedValue(snapshot)
  vi.mocked(setPiModel).mockResolvedValue(snapshot)
})

test('switching during connection ignores the old failure and hydrates the latest target', async () => {
  let failOld!: (reason: Error) => void
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    if (file === 'old')
      return new Promise<void>((_resolve, reject) => {
        failOld = reject
      })
    hydrate({ ...snapshot, instanceId: 'new', sessionFile: file ?? null })
  })
  const old = useConversationStore.getState().connect('project', 'old')
  await useConversationStore.getState().connect('project', 'new')
  failOld(new Error('old connection failed'))
  await old
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'new',
    sessionFile: 'new',
    status: 'ready',
    error: null,
  })
})

function sessionSnapshot(file: string, text = `回复 ${file}`): RuntimeSnapshot {
  return {
    ...snapshot,
    instanceId: `pi-${file}`,
    sessionId: file,
    sessionFile: file,
    messages: [{ ...message, id: `${file}-answer`, text, status: 'complete' }],
    timeline: [{ kind: 'message', id: `${file}-answer` }],
    sequence: 42,
  }
}

test('returning to a cached session displays the latest reply immediately and waits for a fresh runtime before sending', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file!))
  })
  await useConversationStore.getState().connect('project', 'D:\\history\\A.jsonl')
  useConversationStore.setState({
    messages: [{ ...message, text: '刚完成的新回复', status: 'complete' }],
    lastLocalActivityAt: 3000,
  })
  await useConversationStore.getState().connect('project', 'B')
  let hydrate!: (snapshot: RuntimeSnapshot) => void
  let finish!: () => void
  vi.mocked(connectPi).mockImplementation((_project, onSnapshot) => {
    hydrate = onSnapshot
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const pending = useConversationStore.getState().connect('project', 'd:/history/a.jsonl')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'connecting',
    instanceId: null,
    activeRunId: null,
    sequence: 0,
    blocks: {},
    lastLocalActivityAt: 3000,
    model: snapshot.model,
    messages: [{ text: '刚完成的新回复' }],
  })
  expect(await useConversationStore.getState().send('暂时不能发送')).toBe(false)
  expect(sendPiMessage).not.toHaveBeenCalled()
  hydrate(sessionSnapshot('d:/history/a.jsonl', '后台同步后的最新内容'))
  finish()
  await pending
  expect(useConversationStore.getState()).toMatchObject({
    status: 'ready',
    instanceId: 'pi-d:/history/a.jsonl',
    lastLocalActivityAt: 3000,
    messages: [{ text: '后台同步后的最新内容' }],
  })
})

test('failed reconnects and cancellation preserve cached history and stale hydrations cannot replace another session', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file!))
  })
  await useConversationStore.getState().connect('project', 'A')
  await useConversationStore.getState().connect('project', 'B')
  vi.mocked(connectPi).mockRejectedValueOnce(new Error('助手启动失败'))
  await useConversationStore.getState().connect('project', 'A')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'disconnected',
    instanceId: null,
    messages: [{ text: '回复 A' }],
    error: 'Error: 助手启动失败',
  })
  let staleHydrate!: (value: RuntimeSnapshot) => void
  let finish!: () => void
  vi.mocked(connectPi).mockImplementationOnce((_project, hydrate) => {
    staleHydrate = hydrate
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const pending = useConversationStore.getState().connect('project', 'A')
  await useConversationStore.getState().disconnect()
  expect(useConversationStore.getState()).toMatchObject({
    status: 'disconnected',
    messages: [{ text: '回复 A' }],
    error: null,
  })
  await useConversationStore.getState().connect('project', 'B')
  staleHydrate(sessionSnapshot('A', '不能覆盖当前会话'))
  finish()
  await pending
  expect(useConversationStore.getState()).toMatchObject({
    sessionFile: 'B',
    status: 'ready',
    messages: [{ text: '回复 B' }],
  })
})

test('opening the current session is a no-op while forced refreshes and new chats still connect', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file ?? 'new'))
  })
  await useConversationStore.getState().connect('project', 'A')
  await useConversationStore.getState().connect('project', 'a')
  expect(connectPi).toHaveBeenCalledTimes(1)
  await useConversationStore.getState().connect('project', 'A', { force: true })
  expect(connectPi).toHaveBeenCalledTimes(2)
  let finish!: () => void
  vi.mocked(connectPi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = useConversationStore.getState().connect('project', 'B')
  await useConversationStore.getState().connect('project', 'b')
  expect(connectPi).toHaveBeenCalledTimes(3)
  finish()
  await pending
  await useConversationStore.getState().connect('project')
  await useConversationStore.getState().connect('project')
  expect(connectPi).toHaveBeenCalledTimes(5)
})

test('navigating away during a forced refresh keeps the latest local transcript in cache', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file!))
  })
  await useConversationStore.getState().connect('project', 'A')
  useConversationStore.setState({
    messages: [{ ...message, text: '最新本地回复', status: 'complete' }],
  })
  let finishRefresh!: () => void
  vi.mocked(connectPi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRefresh = resolve
      }),
  )
  const refresh = useConversationStore.getState().connect('project', 'A', { force: true })
  await useConversationStore.getState().connect('project', 'B')
  let finishReturn!: () => void
  vi.mocked(connectPi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishReturn = resolve
      }),
  )
  const returning = useConversationStore.getState().connect('project', 'A')
  expect(useConversationStore.getState().messages[0].text).toBe('最新本地回复')
  finishRefresh()
  finishReturn()
  await Promise.all([refresh, returning])
})

test('cached process records cannot restore a tool approval or a running state', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file!))
  })
  await useConversationStore.getState().connect('project', 'A')
  useConversationStore.setState({
    tools: [
      {
        id: 'old-tool',
        toolCallId: 'old-tool',
        runId: 'old-run',
        name: 'write',
        summary: 'notes.txt',
        arguments: '{}',
        argumentsTruncated: false,
        output: '',
        outputTruncated: false,
        status: 'awaiting_approval',
        approvalId: 'expired-approval',
        durationMs: null,
      },
    ],
  })
  await useConversationStore.getState().connect('project', 'B')
  let finish!: () => void
  vi.mocked(connectPi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = useConversationStore.getState().connect('project', 'A')
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: null,
    activeRunId: null,
    status: 'connecting',
    tools: [{ status: 'interrupted', approvalId: null }],
  })
  finish()
  await pending
})

test('the recent-session cache evicts old and oversized histories', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file!))
  })
  for (let index = 0; index < 9; index++) {
    await useConversationStore.getState().connect('project', `${index}`)
  }
  expect(useConversationStore.getState().sessionCache.size).toBe(8)
  // Touch the oldest remaining entry before adding another conversation.
  await useConversationStore.getState().connect('project', '1')
  await useConversationStore.getState().connect('project', '9')
  expect(useConversationStore.getState().sessionCache.has('1')).toBe(true)
  expect(useConversationStore.getState().sessionCache.has('2')).toBe(false)
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) => {
    hydrate(sessionSnapshot('huge', 'x'.repeat(16_000_001)))
  })
  await useConversationStore.getState().connect('project', 'huge')
  expect(useConversationStore.getState().messages[0].text.length).toBe(16_000_001)
  expect(useConversationStore.getState().sessionCache.has('huge')).toBe(false)
  let finish!: () => void
  vi.mocked(connectPi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = useConversationStore.getState().connect('project', '0')
  expect(useConversationStore.getState().messages).toEqual([])
  expect(useConversationStore.getState().model).toBeNull()
  finish()
  await pending
  for (const file of ['large-A', 'large-B']) {
    vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) => {
      hydrate(sessionSnapshot(file, 'x'.repeat(8_000_000)))
    })
    await useConversationStore.getState().connect('project', file)
  }
  expect(useConversationStore.getState().sessionCache.has('large-a')).toBe(false)
  expect(useConversationStore.getState().sessionCache.has('large-b')).toBe(true)
})

test('tools interleave with messages and cumulative output replaces the previous preview', () => {
  let state: ConversationData = { ...emptyConversation, instanceId: 'pi-1', activeRunId: 'run-1' }
  const tool: ToolCall = {
    id: 'tool-1',
    toolCallId: 'source-1',
    runId: 'run-1',
    name: 'powershell',
    summary: 'example',
    arguments: '{}',
    argumentsTruncated: false,
    output: '',
    outputTruncated: false,
    status: 'awaiting_approval',
    approvalId: 'approval-1',
    durationMs: null,
  }
  state = reducePiEvent(state, event(1, { type: 'message_started', message }))
  state = reducePiEvent(state, event(2, { type: 'tool_changed', tool }))
  expect(state.activity).toContain('确认')
  state = reducePiEvent(
    state,
    event(3, { type: 'tool_changed', tool: { ...tool, status: 'running', output: 'a' } }),
  )
  state = reducePiEvent(
    state,
    event(4, { type: 'tool_changed', tool: { ...tool, status: 'running', output: 'ab' } }),
  )
  state = reducePiEvent(
    state,
    event(5, { type: 'message_started', message: { ...message, id: 'assistant-2' } }),
  )
  expect(state.tools[0].output).toBe('ab')
  expect(state.timeline.map((entry) => entry.id)).toEqual(['assistant-1', 'tool-1', 'assistant-2'])
  state = reducePiEvent(state, event(6, { type: 'disconnected', error: 'closed' }))
  expect(state.tools[0].status).toBe('interrupted')
  expect(state.tools[0].approvalId).toBeNull()
})

test('streamed blocks stay in content order and final message replaces partial output', () => {
  let state: ConversationData = { ...emptyConversation, instanceId: 'pi-1', activeRunId: 'run-1' }
  state = reducePiEvent(state, event(1, { type: 'message_started', message }))
  state = reducePiEvent(
    state,
    event(2, {
      type: 'message_delta',
      messageId: message.id,
      contentIndex: 1,
      kind: 'text',
      delta: '世界',
    }),
  )
  state = reducePiEvent(
    state,
    event(3, {
      type: 'message_delta',
      messageId: message.id,
      contentIndex: 0,
      kind: 'text',
      delta: '你好，',
    }),
  )
  expect(state.messages[0].text).toBe('你好，世界')
  state = reducePiEvent(
    state,
    event(4, {
      type: 'message_completed',
      message: { ...message, text: '权威最终回复', status: 'complete' },
    }),
  )
  expect(state.messages[0].text).toBe('权威最终回复')
  expect(state.blocks[message.id]).toBeUndefined()
})

test('late, duplicated, and previous-process events cannot change the current run', () => {
  const state = {
    ...emptyConversation,
    instanceId: 'pi-1',
    sequence: 5,
    activeRunId: 'run-2',
    status: 'running' as const,
  }
  expect(reducePiEvent(state, event(4, { type: 'disconnected', error: 'old' }))).toBe(state)
  expect(reducePiEvent(state, event(6, { type: 'disconnected', error: 'old' }, 'pi-old'))).toBe(
    state,
  )
  const next = reducePiEvent(
    state,
    event(6, { type: 'run_finished', status: 'complete', error: null }, 'pi-1', 'run-1'),
  )
  expect(next.status).toBe('running')
  expect(next.activeRunId).toBe('run-2')
})

test('a fast completion before prompt acknowledgement is not changed back to running', async () => {
  useConversationStore.setState({
    ...snapshot,
    status: 'ready',
    instanceId: snapshot.instanceId,
    activeRunId: null,
  })
  vi.mocked(sendPiMessage).mockImplementation(async (_instance, runId) => {
    useConversationStore
      .getState()
      .receive([event(1, { type: 'run_finished', status: 'complete', error: null }, 'pi-1', runId)])
  })
  expect(await useConversationStore.getState().send('你好')).toBe(true)
  expect(useConversationStore.getState().status).toBe('ready')
})

test('stop stays pending until Pi confirms it and blocks another send', async () => {
  useConversationStore.setState({ instanceId: 'pi-1', status: 'running', activeRunId: 'run-1' })
  vi.mocked(stopPi).mockResolvedValue()
  await useConversationStore.getState().stop()
  expect(useConversationStore.getState().status).toBe('stopping')
  expect(await useConversationStore.getState().send('another')).toBe(false)
  useConversationStore
    .getState()
    .receive([event(1, { type: 'run_finished', status: 'cancelled', error: null })])
  expect(useConversationStore.getState().status).toBe('ready')
})

test('connection failures are actionable and do not fabricate a ready model', async () => {
  vi.mocked(connectPi).mockRejectedValue('没有可用模型，请在 CC Switch 中检查配置。')
  await useConversationStore.getState().connect('project')
  expect(useConversationStore.getState().status).toBe('disconnected')
  expect(useConversationStore.getState().error).toContain('CC Switch')
  expect(useConversationStore.getState().model).toBeNull()
})

test('a delayed run-start event cannot undo a pending stop', () => {
  const state: ConversationData = {
    ...emptyConversation,
    instanceId: 'pi-1',
    activeRunId: 'run-1',
    status: 'stopping',
  }
  const next = reducePiEvent(
    state,
    event(1, { type: 'run_started', message: { ...message, role: 'user', text: 'hello' } }),
  )
  expect(next.status).toBe('stopping')
  expect(next.activity).toBe('正在停止…')
})

test('unsupported efforts are rejected while supported levels and Default can be selected', async () => {
  useConversationStore.setState({
    instanceId: 'pi-1',
    status: 'ready',
    thinkingLevel: 'medium',
    availableThinkingLevels: ['off', 'high'],
  })
  vi.mocked(setPiThinkingLevel).mockImplementation(async (_instanceId, thinkingLevel) => ({
    ...snapshot,
    thinkingLevel,
    availableThinkingLevels: ['off', 'high'],
  }))
  for (const level of ['low', 'medium', 'xhigh', 'max']) {
    await useConversationStore.getState().changeThinkingLevel(level)
  }
  expect(setPiThinkingLevel).not.toHaveBeenCalled()
  for (const level of ['high', 'default']) {
    await useConversationStore.getState().changeThinkingLevel(level)
    expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-1', level)
    expect(useConversationStore.getState()).toMatchObject({
      status: 'ready',
      thinkingLevel: level,
      requestedThinkingLevel: level,
      settingsPending: null,
    })
  }
  useConversationStore.setState({ status: 'running' })
  await useConversationStore.getState().changeThinkingLevel('low')
  expect(setPiThinkingLevel).toHaveBeenCalledTimes(2)
})

test('turn timing uses native start and finish events rather than the time the UI received them', () => {
  const state: ConversationData = { ...emptyConversation, instanceId: 'pi-1' }
  const started = reducePiEvent(
    state,
    event(1, {
      type: 'run_started',
      message: {
        ...message,
        id: 'run-1-user',
        role: 'user',
        text: '你好',
        status: 'complete',
        startedAt: 100_000,
      },
    }),
  )
  const finished = reducePiEvent(
    started,
    event(2, { type: 'run_finished', status: 'complete', error: null, finishedAt: 121_000 }),
  )
  expect(finished.messages[0]).toMatchObject({ startedAt: 100_000, finishedAt: 121_000 })
  expect(finished.lastLocalActivityAt).toBe(121_000)
  expect(finished.activeRunId).toBeNull()
})

test('a failed thinking change preserves the selected effort and a late result cannot replace a new session', async () => {
  useConversationStore.setState({
    instanceId: 'pi-1',
    status: 'ready',
    thinkingLevel: 'medium',
    availableThinkingLevels: snapshot.availableThinkingLevels,
  })
  vi.mocked(setPiThinkingLevel).mockRejectedValueOnce(new Error('setting failed'))
  await useConversationStore.getState().changeThinkingLevel('high')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'ready',
    thinkingLevel: 'medium',
    error: 'Error: setting failed',
  })
  let finish!: (value: RuntimeSnapshot) => void
  vi.mocked(setPiThinkingLevel).mockImplementation((instanceId) =>
    instanceId === 'pi-1'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve({ ...snapshot, instanceId: 'pi-2', thinkingLevel: 'high' }),
  )
  const pending = useConversationStore.getState().changeThinkingLevel('max')
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate) => {
    hydrate({ ...snapshot, instanceId: 'pi-2' })
  })
  await useConversationStore.getState().connect('other')
  finish({ ...snapshot, thinkingLevel: 'max' })
  await pending
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'pi-2',
    thinkingLevel: 'high',
    requestedThinkingLevel: 'max',
    settingsPending: null,
    status: 'ready',
  })
})

test('unsupported manual efforts fall back to Default on model changes and reconnects keep Default', async () => {
  useConversationStore.setState({ instanceId: 'pi-1', status: 'ready', model: snapshot.model })
  vi.mocked(setPiThinkingLevel).mockImplementation(async (instanceId) => ({
    ...snapshot,
    instanceId,
    thinkingLevel: 'high',
    availableThinkingLevels: ['off', 'high'],
  }))
  await useConversationStore.getState().changeThinkingLevel('low')
  expect(loadThinkingPreference()).toBe('low')
  expect(useConversationStore.getState()).toMatchObject({
    requestedThinkingLevel: 'low',
    thinkingLevel: 'high',
  })
  const model = { provider: 'other', id: 'next', name: 'Next' }
  vi.mocked(setPiModel).mockResolvedValue({ ...snapshot, model, thinkingLevel: 'off' })
  vi.mocked(setPiThinkingLevel).mockResolvedValue({ ...snapshot, model, thinkingLevel: 'high' })
  await useConversationStore.getState().changeModel(model)
  expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-1', 'low')
  expect(useConversationStore.getState()).toMatchObject({
    model,
    requestedThinkingLevel: 'low',
    thinkingLevel: 'high',
  })
  vi.mocked(setPiModel).mockResolvedValue({
    ...snapshot,
    model,
    thinkingLevel: 'high',
    availableThinkingLevels: ['off', 'high'],
  })
  await useConversationStore.getState().changeModel(model)
  expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-1', 'default')
  expect(useConversationStore.getState().requestedThinkingLevel).toBe('default')
  expect(loadThinkingPreference()).toBe('default')
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate) => {
    hydrate({ ...snapshot, instanceId: 'pi-2' })
  })
  vi.mocked(setPiThinkingLevel).mockResolvedValue({
    ...snapshot,
    instanceId: 'pi-2',
    thinkingLevel: 'high',
  })
  await useConversationStore.getState().connect('project')
  expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-2', 'default')
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'pi-2',
    status: 'ready',
    requestedThinkingLevel: 'default',
    thinkingLevel: 'high',
    settingsPending: null,
  })
})

test.each(['model', 'thinking'] as const)(
  'changing %s leaves the transcript, activity and connection state untouched and blocks racing writes',
  async (kind) => {
    const messages = [{ ...message, text: '保留回复', status: 'complete' }]
    const timeline = [{ kind: 'message', id: message.id }]
    const tools: ToolCall[] = []
    const blocks = {}
    useConversationStore.setState({
      instanceId: 'pi-1',
      status: 'ready',
      messages,
      timeline,
      tools,
      blocks,
      activity: '已停止生成',
      sequence: 42,
    })
    let finish!: (value: RuntimeSnapshot) => void
    const result = new Promise<RuntimeSnapshot>((resolve) => {
      finish = resolve
    })
    vi.mocked(setPiModel).mockReturnValue(result)
    vi.mocked(setPiThinkingLevel).mockReturnValue(result)
    const states: string[] = []
    const unsubscribe = useConversationStore.subscribe((state) => states.push(state.status))
    try {
      const pending =
        kind === 'model'
          ? useConversationStore.getState().changeModel(snapshot.model!)
          : useConversationStore.getState().changeThinkingLevel('low')
      expect(useConversationStore.getState().settingsPending).toBe(kind)
      expect(await useConversationStore.getState().send('不能抢先发送')).toBe(false)
      await useConversationStore.getState().changeModel(snapshot.model!)
      await useConversationStore.getState().changeThinkingLevel('high')
      expect(setPiModel).toHaveBeenCalledTimes(kind === 'model' ? 1 : 0)
      expect(setPiThinkingLevel).toHaveBeenCalledTimes(kind === 'thinking' ? 1 : 0)
      finish(snapshot)
      await pending
      const state = useConversationStore.getState()
      expect(states.every((status) => status === 'ready')).toBe(true)
      expect(state.messages).toBe(messages)
      expect(state.timeline).toBe(timeline)
      expect(state.tools).toBe(tools)
      expect(state.blocks).toBe(blocks)
      expect(state.activity).toBe('已停止生成')
      expect(state.sequence).toBe(42)
      expect(state.settingsPending).toBeNull()
    } finally {
      unsubscribe()
    }
  },
)

test('failed changes keep the last saved preference and disconnected results cannot revive settings', async () => {
  saveThinkingPreference('medium')
  useConversationStore.setState({
    instanceId: 'pi-1',
    status: 'ready',
    requestedThinkingLevel: 'medium',
  })
  vi.mocked(setPiThinkingLevel).mockRejectedValueOnce('setting failed')
  await useConversationStore.getState().changeThinkingLevel('low')
  expect(useConversationStore.getState().requestedThinkingLevel).toBe('medium')
  expect(loadThinkingPreference()).toBe('medium')
  let finish!: (value: RuntimeSnapshot) => void
  vi.mocked(setPiThinkingLevel).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const pending = useConversationStore.getState().changeThinkingLevel('max')
  useConversationStore.getState().receive([event(1, { type: 'disconnected', error: 'closed' })])
  finish(snapshot)
  await pending
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: null,
    status: 'disconnected',
    settingsPending: null,
    error: 'closed',
  })
  expect(loadThinkingPreference()).toBe('medium')
})
