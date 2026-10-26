import { beforeEach, expect, test, vi } from 'vitest'
import { compactPi } from '@/lib/composer'
import { stopPi } from '@/lib/pi'
import { emptyConversation, useConversationStore } from './store'

vi.mock('@/lib/composer', () => ({ compactPi: vi.fn() }))
vi.mock('@/lib/pi', () => ({
  connectPi: vi.fn(),
  disconnectPi: vi.fn(),
  sendPiMessage: vi.fn(),
  rewritePiMessage: vi.fn(),
  setPiModel: vi.fn(),
  setPiThinkingLevel: vi.fn(),
  setPiPermission: vi.fn(),
  stopPi: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  vi.clearAllMocks()
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({
    instanceId: 'runtime',
    status: 'ready',
    messages: [
      {
        id: 'old-user',
        role: 'user',
        text: 'Earlier',
        thinking: '',
        status: 'complete',
        error: null,
        finishedAt: 100,
      },
    ],
  })
})

test('compaction blocks sends, supports stop and finishes without altering the transcript', async () => {
  let complete!: () => void
  vi.mocked(compactPi).mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  const before = useConversationStore.getState().messages
  const pending = useConversationStore.getState().compact('保留路径')
  const runId = useConversationStore.getState().activeRunId!
  expect(compactPi).toHaveBeenCalledExactlyOnceWith('runtime', runId, '保留路径')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'running',
    activity: '正在压缩上下文…',
  })
  expect(await useConversationStore.getState().send('Do not race')).toBe(false)
  expect(await useConversationStore.getState().compact()).toBe(false)
  await useConversationStore.getState().stop()
  expect(stopPi).toHaveBeenCalledExactlyOnceWith('runtime')
  useConversationStore.getState().receive([
    {
      instanceId: 'runtime',
      projectPath: 'project',
      sessionId: 'session',
      runId,
      sequence: 1,
      data: { type: 'run_finished', status: 'cancelled', error: null },
    },
  ])
  complete()
  await pending
  expect(useConversationStore.getState()).toMatchObject({
    status: 'ready',
    activeRunId: null,
    messages: before,
  })
})

test('compaction errors restore readiness and stale failures leave a newer session alone', async () => {
  vi.mocked(compactPi).mockRejectedValueOnce('压缩失败')
  expect(await useConversationStore.getState().compact()).toBe(false)
  expect(useConversationStore.getState()).toMatchObject({ status: 'ready', error: '压缩失败' })
  let fail!: (reason: string) => void
  vi.mocked(compactPi).mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject
    }),
  )
  const pending = useConversationStore.getState().compact()
  useConversationStore.setState({ ...emptyConversation, instanceId: 'other', status: 'ready' })
  fail('Old failure')
  expect(await pending).toBe(false)
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'other',
    status: 'ready',
    error: null,
  })
})
