import { beforeEach, expect, test, vi } from 'vitest'
import { emptyConversation, isSessionBusy, useConversationStore } from './store'
import { findCachedSession } from './session-cache'
import { connectPi, sendPiMessage, setPiThinkingLevel, stopPi } from '@/lib/pi'
import type { ChatMessage, PiEvent, RuntimeSnapshot } from '@/lib/generated/pi'

vi.mock('@/lib/pi', () => ({
  connectPi: vi.fn(),
  disconnectPi: vi.fn(),
  sendPiMessage: vi.fn(),
  stopPi: vi.fn(),
  rewritePiMessage: vi.fn(),
  setPiModel: vi.fn(),
  setPiThinkingLevel: vi.fn(),
  setPiPermission: vi.fn(),
}))

const reply: ChatMessage = {
  id: 'answer-A',
  role: 'assistant',
  text: '开头',
  thinking: '',
  status: 'streaming',
  error: null,
}
const snapshot = (name: string, active = false): RuntimeSnapshot => ({
  instanceId: `pi-${name}`,
  sessionId: name,
  sessionFile: `${name}.jsonl`,
  projectPath: name,
  readOnly: null,
  model: null,
  models: [],
  permissionMode: 'ask',
  thinkingLevel: 'off',
  availableThinkingLevels: ['off'],
  messages: active ? [reply] : [],
  tools: [],
  timeline: active ? [{ kind: 'message', id: reply.id }] : [],
  activeRunId: active ? 'run-A' : null,
  sequence: active ? 2 : 0,
})
const delta = (sequence: number, text: string): PiEvent => ({
  instanceId: 'pi-A',
  sessionId: 'A',
  projectPath: 'A',
  runId: 'run-A',
  sequence,
  data: { type: 'message_delta', messageId: reply.id, contentIndex: 0, kind: 'text', delta: text },
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  vi.mocked(setPiThinkingLevel).mockImplementation(async (id) => snapshot(id.slice(3)))
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _receive, file) => {
    hydrate(snapshot(file!.split('.')[0]))
  })
})

async function startA() {
  let receive!: (event: PiEvent) => void
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate, event) => {
    receive = event
    hydrate(snapshot('A', true))
  })
  await useConversationStore.getState().connect('A', 'A.jsonl', { sessionId: 'A' })
  return receive
}

test('switching retains queued streaming events and background completion without changing the visible chat', async () => {
  const receive = await startA()
  await useConversationStore.getState().connect('B', 'B.jsonl', { sessionId: 'B' })
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'pi-B',
    status: 'ready',
    messages: [],
  })
  expect(isSessionBusy({ id: 'A', path: 'A.jsonl' })).toBe(true)
  expect(isSessionBusy({ id: 'B', path: 'B.jsonl' })).toBe(false)
  receive(delta(3, ' 后台'))
  // Navigation flushes the pending 16 ms batch instead of discarding it.
  const pending = useConversationStore.getState().connect('C', 'C.jsonl', { sessionId: 'C' })
  expect(
    useConversationStore.getState().backgroundSessions.get('pi-A')?.data.messages[0].text,
  ).toBe('开头 后台')
  await pending
  useConversationStore
    .getState()
    .receive([
      delta(4, ' 完成'),
      { ...delta(5, ''), data: { type: 'run_finished', status: 'complete', error: null } },
    ])
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'pi-C',
    status: 'ready',
    messages: [],
    error: null,
  })
  expect(useConversationStore.getState().backgroundSessions.size).toBe(0)
  const cached = findCachedSession(useConversationStore.getState().sessionCache, 'A')?.[1]
  expect(cached?.display.messages).toMatchObject([{ text: '开头 后台 完成', status: 'complete' }])
  useConversationStore.getState().receive([delta(99, '迟到的旧事件')])
  expect(findCachedSession(useConversationStore.getState().sessionCache, 'A')?.[1]).toBe(cached)
})

test('reopening a busy session hydrates its prefix once and keeps later chunks and stop scoped to it', async () => {
  await startA()
  await useConversationStore.getState().connect('B', 'B.jsonl', { sessionId: 'B' })
  useConversationStore.getState().receive([delta(3, ' 后台')])
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) =>
    hydrate({
      ...snapshot('A', true),
      sequence: 3,
      messages: [{ ...reply, text: '开头 后台' }],
    }),
  )
  await useConversationStore.getState().connect('A', 'A.jsonl', { sessionId: 'A' })
  useConversationStore.getState().receive([delta(3, '重复'), delta(4, ' 继续')])
  expect(useConversationStore.getState().messages).toMatchObject([{ text: '开头 后台 继续' }])
  expect(useConversationStore.getState().backgroundSessions.size).toBe(0)
  await useConversationStore.getState().stop()
  expect(stopPi).toHaveBeenCalledExactlyOnceWith('pi-A')
  expect(useConversationStore.getState().status).toBe('stopping')
})

test('a send failure after switching is scoped to the outgoing session', async () => {
  let fail!: (reason: Error) => void
  vi.mocked(sendPiMessage).mockReturnValueOnce(
    new Promise((_done, reject) => {
      fail = reject
    }),
  )
  useConversationStore.setState({ ...emptyConversation, ...snapshot('A'), status: 'ready' })
  const sending = useConversationStore.getState().send('test')
  await useConversationStore.getState().connect('B', 'B.jsonl', { sessionId: 'B' })
  fail(new Error('A failed'))
  expect(await sending).toBe(false)
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'pi-B',
    status: 'ready',
    error: null,
  })
  expect(useConversationStore.getState().backgroundSessions.size).toBe(0)
})

test('switching away and back preserves the pending tool approval in its original run', async () => {
  await startA()
  const tool = {
    id: 'tool-A',
    toolCallId: 'call-A',
    runId: 'run-A',
    name: 'write',
    summary: 'fixture',
    arguments: '{}',
    argumentsTruncated: false,
    output: '',
    outputTruncated: false,
    status: 'awaiting_approval',
    approvalId: 'approval-A',
    durationMs: null,
  }
  useConversationStore
    .getState()
    .receive([{ ...delta(3, ''), data: { type: 'tool_changed', tool } }])
  await useConversationStore.getState().connect('B', 'B.jsonl', { sessionId: 'B' })
  expect(useConversationStore.getState().tools).toEqual([])
  expect(useConversationStore.getState().backgroundSessions.get('pi-A')?.data.tools).toEqual([tool])
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) =>
    hydrate({
      ...snapshot('A', true),
      sequence: 3,
      tools: [tool],
    }),
  )
  await useConversationStore.getState().connect('A', 'A.jsonl', { sessionId: 'A' })
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'pi-A',
    activeRunId: 'run-A',
    tools: [tool],
  })
})
