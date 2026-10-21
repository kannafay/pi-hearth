import { beforeEach, expect, test, vi } from 'vitest'
import {
  emptyConversation,
  reducePiEvent,
  useConversationStore,
  type ConversationData,
} from './store'
import type { ChatMessage, EventData, PiEvent, RuntimeSnapshot, ToolCall } from '@/lib/generated/pi'
import { connectPi, sendPiMessage, stopPi } from '@/lib/pi'

vi.mock('@/lib/pi', () => ({
  connectPi: vi.fn(),
  disconnectPi: vi.fn(),
  sendPiMessage: vi.fn(),
  stopPi: vi.fn(),
  setPiModel: vi.fn(),
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
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  vi.clearAllMocks()
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
