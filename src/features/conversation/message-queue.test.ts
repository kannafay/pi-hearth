import { beforeEach, expect, test, vi } from 'vitest'
import { isSessionBusy, useConversationStore } from './store'
import {
  connectPi,
  removeQueuedPiMessage,
  sendPiMessage,
  setPiPermission,
  updatePiNextSettings,
} from '@/lib/pi'
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
  updatePiNextSettings: vi.fn(),
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
  vi.mocked(updatePiNextSettings)
    .mockReset()
    .mockImplementation(async (_id, patch) => {
      const state = useConversationStore.getState()
      return event(state.sequence + 1, {
        type: 'settings_changed',
        settings: {
          model: state.model,
          thinkingLevel: state.thinkingLevel,
          availableThinkingLevels: state.availableThinkingLevels,
          permissionMode: state.permissionMode,
          pending: { ...state.pendingSettings, ...patch } as typeof patch,
          applying: false,
          requestedThinkingLevel: null,
        },
        error: null,
      })
    })
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

test('settings can change while a queue submission is awaiting acceptance', async () => {
  let accept!: (value: PiEvent) => void
  vi.mocked(sendPiMessage).mockReturnValueOnce(new Promise((resolve) => (accept = resolve)))
  const sending = useConversationStore.getState().send('第二条')
  expect(useConversationStore.getState().queueSubmissions).toBe(1)
  await useConversationStore.getState().changePermission('full')
  expect(useConversationStore.getState().pendingSettings).toEqual({ permissionMode: 'full' })
  expect(useConversationStore.getState().permissionMode).toBe('ask')
  accept(event(2, { type: 'queue_changed', messages: [queued] }))
  expect(await sending).toBe(true)
  expect(useConversationStore.getState()).toMatchObject({
    queueSubmissions: 0,
    queuedMessages: [queued],
  })
  await useConversationStore.getState().changePermission('auto')
  expect(useConversationStore.getState().permissionMode).toBe('ask')
  expect(useConversationStore.getState().pendingSettings).toEqual({ permissionMode: 'auto' })
  const messages = useConversationStore.getState().queuedMessages
  useConversationStore.getState().receive([event(1, { type: 'queue_changed', messages: [] })])
  expect(useConversationStore.getState().queuedMessages).toBe(messages)
})

test('pending settings transfer to the runtime before another message is queued', async () => {
  await useConversationStore.getState().changePermission('full')
  expect(useConversationStore.getState().pendingSettings).toEqual({ permissionMode: 'full' })
  expect(await useConversationStore.getState().send('设置生效后发送')).toBe(true)
  expect(updatePiNextSettings).toHaveBeenCalledWith('pi-A', { permissionMode: 'full' }, null)
  expect(vi.mocked(updatePiNextSettings).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(sendPiMessage).mock.invocationCallOrder[0],
  )
  expect(useConversationStore.getState().activeRunId).toBe('first')
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

test('runtime permission updates take effect before the next queued reply starts', async () => {
  useConversationStore.setState({ queuedMessages: [queued] })
  await useConversationStore.getState().changePermission('auto')
  expect(useConversationStore.getState().permissionMode).toBe('ask')
  useConversationStore
    .getState()
    .receive([event(2, { type: 'run_finished', status: 'complete', error: null })])
  expect(setPiPermission).not.toHaveBeenCalled()
  useConversationStore.getState().receive([
    event(
      3,
      {
        type: 'settings_changed',
        settings: {
          model: null,
          thinkingLevel: 'off',
          availableThinkingLevels: ['off'],
          permissionMode: 'auto',
          pending: null,
          applying: false,
          requestedThinkingLevel: null,
        },
        error: null,
      },
      null,
    ),
    event(4, { type: 'run_started', message: { ...user, id: 'second-user' } }, 'second'),
    event(5, { type: 'queue_changed', messages: [] }, 'second'),
  ])
  expect(setPiPermission).not.toHaveBeenCalled()
  expect(useConversationStore.getState()).toMatchObject({
    permissionMode: 'auto',
    activeRunId: 'second',
    runtimeSettingsPending: false,
    pendingSettings: null,
  })
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
