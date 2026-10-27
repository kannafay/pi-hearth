import { beforeEach, expect, test, vi } from 'vitest'
import { isSessionBusy, useConversationStore } from './store'
import { connectPi, removeQueuedPiMessage, sendPiMessage, setPiPermission } from '@/lib/pi'
import type {
  ChatMessage,
  EventData,
  PiEvent,
  QueuedMessage,
  RuntimeSnapshot,
} from '@/lib/generated/pi'

vi.mock('@/lib/pi', () => ({
  connectPi: vi.fn(),
  disconnectPi: vi.fn(),
  sendPiMessage: vi.fn(),
  removeQueuedPiMessage: vi.fn(),
  stopPi: vi.fn(),
  rewritePiMessage: vi.fn(),
  setPiModel: vi.fn(),
  setPiPermission: vi.fn(),
  setPiThinkingLevel: vi.fn(),
}))

const user: ChatMessage = {
  id: 'first-user',
  role: 'user',
  text: '第一条',
  thinking: '',
  status: 'complete',
  error: null,
}
const queued: QueuedMessage = { id: 'second', text: '第二条', attachments: [] }
const snapshot: RuntimeSnapshot = {
  instanceId: 'pi-B',
  projectPath: 'B',
  sessionId: 'B',
  sessionFile: 'B.jsonl',
  readOnly: null,
  permissionMode: 'ask',
  model: null,
  models: [],
  thinkingLevel: 'off',
  availableThinkingLevels: ['off'],
  messages: [],
  queuedMessages: [],
  tools: [],
  timeline: [],
  activeRunId: null,
  sequence: 0,
}

function event(sequence: number, data: EventData, runId: string | null = 'first'): PiEvent {
  return { instanceId: 'pi-A', projectPath: 'A', sessionId: 'A', runId, sequence, data }
}

beforeEach(() => {
  vi.clearAllMocks()
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({
    instanceId: 'pi-A',
    sessionId: 'A',
    sessionFile: 'A.jsonl',
    status: 'running',
    activeRunId: 'first',
    messages: [user],
    connectionTarget: { projectPath: 'A', sessionPath: 'A.jsonl' },
  })
  vi.mocked(sendPiMessage).mockReset().mockResolvedValue(undefined)
  vi.mocked(removeQueuedPiMessage).mockReset().mockResolvedValue(undefined)
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate) => hydrate(snapshot))
})

test('sending during a reply queues the message without replacing its active run or transcript', async () => {
  const before = useConversationStore.getState()
  expect(await before.send('第二条', ['file-1'])).toBe(true)
  expect(sendPiMessage).toHaveBeenCalledWith('pi-A', expect.any(String), '第二条', ['file-1'])
  expect(useConversationStore.getState()).toMatchObject({ status: 'running', activeRunId: 'first' })
  expect(useConversationStore.getState().messages).toBe(before.messages)
  useConversationStore.getState().receive([event(1, { type: 'queue_changed', messages: [queued] })])
  expect(useConversationStore.getState().queuedMessages).toEqual([queued])
})

test('rejected queue submissions leave the current answer running and preserve accepted queue items', async () => {
  useConversationStore.setState({ queuedMessages: [queued] })
  vi.mocked(sendPiMessage).mockRejectedValueOnce(new Error('队列已满'))
  expect(await useConversationStore.getState().send('第三条')).toBe(false)
  expect(useConversationStore.getState()).toMatchObject({
    status: 'running',
    activeRunId: 'first',
    messages: [user],
    queuedMessages: [queued],
  })
  expect(useConversationStore.getState().error).toContain('队列已满')
})

test('the acceptance acknowledgement closes the settings race before batched events are delivered', async () => {
  let accept!: (value: PiEvent) => void
  vi.mocked(sendPiMessage).mockReturnValueOnce(new Promise((resolve) => (accept = resolve)))
  const sending = useConversationStore.getState().send('第二条')
  expect(useConversationStore.getState().queueSubmissions).toBe(1)
  await useConversationStore.getState().changePermission('full')
  expect(useConversationStore.getState().pendingSettings).toBeNull()
  accept(event(1, { type: 'queue_changed', messages: [queued] }))
  expect(await sending).toBe(true)
  expect(useConversationStore.getState()).toMatchObject({
    queueSubmissions: 0,
    queuedMessages: [queued],
  })
  await useConversationStore.getState().changePermission('full')
  expect(useConversationStore.getState().permissionMode).toBe('ask')
  expect(useConversationStore.getState().pendingSettings).toBeNull()
  const messages = useConversationStore.getState().queuedMessages
  useConversationStore.getState().receive([event(1, { type: 'queue_changed', messages: [] })])
  expect(useConversationStore.getState().queuedMessages).toBe(messages)
})

test('a setting selected during the current reply takes effect before further messages can be queued', async () => {
  await useConversationStore.getState().changePermission('full')
  expect(useConversationStore.getState().pendingSettings).toEqual({ permissionMode: 'full' })
  expect(await useConversationStore.getState().send('设置生效后发送')).toBe(false)
  expect(sendPiMessage).not.toHaveBeenCalled()
})

test('background state survives the gap between completion and the next queued run', async () => {
  useConversationStore.setState({ queuedMessages: [queued] })
  await useConversationStore.getState().connect('B', 'B.jsonl', { sessionId: 'B' })
  useConversationStore
    .getState()
    .receive([event(1, { type: 'run_finished', status: 'complete', error: null })])
  expect(isSessionBusy({ id: 'A', path: 'A.jsonl' })).toBe(true)
  expect(
    useConversationStore.getState().backgroundSessions.get('pi-A')?.data.queuedMessages,
  ).toEqual([queued])
  useConversationStore
    .getState()
    .receive([
      event(
        2,
        { type: 'run_started', message: { ...user, id: 'second-user', text: '第二条' } },
        'second',
      ),
      event(3, { type: 'queue_changed', messages: [] }, 'second'),
    ])
  expect(useConversationStore.getState().backgroundSessions.get('pi-A')?.data).toMatchObject({
    status: 'running',
    activeRunId: 'second',
    queuedMessages: [],
  })
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'pi-B',
    sessionId: 'B',
    messages: [],
  })
  useConversationStore
    .getState()
    .receive([event(4, { type: 'run_finished', status: 'complete', error: null }, 'second')])
  expect(useConversationStore.getState().backgroundSessions.size).toBe(0)
  expect(isSessionBusy({ id: 'A', path: 'A.jsonl' })).toBe(false)
})

test('reopening a running session restores its queue from the native snapshot', async () => {
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) =>
    hydrate({
      ...snapshot,
      instanceId: 'pi-A-new',
      sessionId: 'A',
      sessionFile: 'A.jsonl',
      projectPath: 'A',
      messages: [user],
      activeRunId: 'first',
      queuedMessages: [queued],
    }),
  )
  await useConversationStore.getState().connect('A', 'A.jsonl', { force: true, sessionId: 'A' })
  expect(useConversationStore.getState().queuedMessages).toEqual([queued])
  await useConversationStore.getState().removeQueuedMessage('second')
  expect(removeQueuedPiMessage).toHaveBeenCalledExactlyOnceWith('pi-A-new', 'second')
})

test('deferred permission choices wait for queued replies to finish', async () => {
  useConversationStore.setState({
    queuedMessages: [queued],
    pendingSettings: { permissionMode: 'auto' },
  })
  vi.mocked(setPiPermission).mockResolvedValue({
    ...snapshot,
    instanceId: 'pi-A',
    permissionMode: 'auto',
  })
  useConversationStore
    .getState()
    .receive([event(1, { type: 'run_finished', status: 'complete', error: null })])
  expect(setPiPermission).not.toHaveBeenCalled()
  useConversationStore
    .getState()
    .receive([
      event(2, { type: 'run_started', message: { ...user, id: 'second-user' } }, 'second'),
      event(3, { type: 'queue_changed', messages: [] }, 'second'),
      event(4, { type: 'run_finished', status: 'complete', error: null }, 'second'),
    ])
  await vi.waitFor(() => expect(setPiPermission).toHaveBeenCalledExactlyOnceWith('pi-A', 'auto'))
})

test('queue events from other sessions or older sequence numbers cannot replace the visible queue', () => {
  useConversationStore.getState().receive([event(3, { type: 'queue_changed', messages: [queued] })])
  useConversationStore
    .getState()
    .receive([
      event(2, { type: 'queue_changed', messages: [] }),
      { ...event(4, { type: 'queue_changed', messages: [] }), instanceId: 'old-instance' },
    ])
  expect(useConversationStore.getState().queuedMessages).toEqual([queued])
  expect(useConversationStore.getState().status).toBe('running')
})
