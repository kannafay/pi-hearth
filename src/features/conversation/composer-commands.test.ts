import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { loadComposerCommands } from '@/lib/composer'
import { executeComposerCommand } from './composer-commands'
import { toast } from '@/lib/toast'
import { useConversationStore } from './store'

vi.mock('@/lib/composer', () => ({ loadComposerCommands: vi.fn(), compactPi: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))

const first = { provider: 'one', id: 'shared', name: 'Old Name' }
const second = { provider: 'two', id: 'shared', name: 'Other Name' }
const session = {
  id: 'session',
  path: 'session.jsonl',
  cwd: 'project',
  title: 'Before',
  messageCount: 1,
  modified: 1,
}
const actions = { onSettings: vi.fn(), onResume: vi.fn(), onRename: vi.fn(), onPicker: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState({
    instanceId: 'runtime',
    status: 'ready',
    sessionFile: session.path,
    sessionId: session.id,
    models: [first, second],
    availableThinkingLevels: ['off', 'high'],
    changeModel: vi.fn().mockResolvedValue(undefined),
    changeThinkingLevel: vi.fn().mockResolvedValue(undefined),
    compact: vi.fn().mockResolvedValue(true),
  })
  useWorkspaceStore.setState({
    sessions: [session],
    projectPath: 'project',
    newConversation: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
  })
  vi.mocked(loadComposerCommands).mockResolvedValue([
    { name: 'skill:design', description: 'Design' },
  ])
})

test('app commands route to existing actions without becoming model prompts', async () => {
  for (const name of ['settings', 'resume', 'name', 'model', 'thinking', 'new']) {
    expect(await executeComposerCommand(`/${name}`, 0, actions)).toBe(true)
  }
  expect(actions.onSettings).toHaveBeenCalledOnce()
  expect(actions.onResume).toHaveBeenCalledOnce()
  expect(actions.onRename).toHaveBeenCalledOnce()
  expect(actions.onPicker.mock.calls).toEqual([['model'], ['thinking']])
  expect(useWorkspaceStore.getState().newConversation).toHaveBeenCalledExactlyOnceWith('project')
  await executeComposerCommand('/name 修改后的标题', 0, actions)
  expect(useWorkspaceStore.getState().renameSession).toHaveBeenCalledExactlyOnceWith(
    session,
    '修改后的标题',
  )
})

test('explicit models use provider identity or fresh display names and reject ambiguity', async () => {
  await expect(executeComposerCommand('/model shared', 0, actions)).rejects.toThrow('同名模型')
  await executeComposerCommand('/model two/shared', 0, actions)
  expect(useConversationStore.getState().changeModel).toHaveBeenCalledExactlyOnceWith(second)
  const renamed = { ...first, name: 'Fresh Name' }
  useConversationStore.setState({ modelCatalog: [renamed] })
  await executeComposerCommand('/model Fresh Name', 0, actions)
  expect(useConversationStore.getState().changeModel).toHaveBeenLastCalledWith(renamed)
})

test('thinking arguments respect current capabilities including Off and Default', async () => {
  await executeComposerCommand('/thinking Off', 0, actions)
  await executeComposerCommand('/thinking default', 0, actions)
  expect(vi.mocked(useConversationStore.getState().changeThinkingLevel).mock.calls).toEqual([
    ['off'],
    ['default'],
  ])
  await expect(executeComposerCommand('/thinking max', 0, actions)).rejects.toThrow('不支持')
})

test('result notifications require a successful operation in the current conversation', async () => {
  await executeComposerCommand('/model two/shared', 0, actions)
  expect(toast.success).toHaveBeenCalledExactlyOnceWith('模型已切换')
  vi.mocked(toast.success).mockClear()
  useConversationStore.setState({
    changeThinkingLevel: vi.fn(async () => {
      useConversationStore.setState({ error: '无法切换' })
    }),
  })
  expect(await executeComposerCommand('/thinking high', 0, actions)).toBe(false)
  expect(toast.success).not.toHaveBeenCalled()
  useWorkspaceStore.setState({
    renameSession: vi.fn(async () => {
      useWorkspaceStore.setState({ error: '无法重命名' })
    }),
  })
  expect(await executeComposerCommand('/name 新标题', 0, actions)).toBe(false)
  expect(toast.success).not.toHaveBeenCalled()
  useConversationStore.setState({
    error: null,
    changeModel: vi.fn(async () => {
      useConversationStore.setState({ instanceId: 'another-runtime' })
    }),
  })
  await executeComposerCommand('/model two/shared', 0, actions)
  expect(toast.success).not.toHaveBeenCalled()
})

test('only loaded skill commands can continue through the prompt path with attachments', async () => {
  expect(await executeComposerCommand('/skill:design 做个页面', 1, actions)).toBeNull()
  await expect(executeComposerCommand('/skill:disabled', 0, actions)).rejects.toThrow('未启用')
  await expect(executeComposerCommand('/hearth-permission', 0, actions)).rejects.toThrow('未支持')
  await expect(executeComposerCommand('/settings', 1, actions)).rejects.toThrow('附件')
  await expect(executeComposerCommand('/new extra', 0, actions)).rejects.toThrow('不需要参数')
})

test('compaction passes instructions without adding a message and refuses empty conversations', async () => {
  await expect(executeComposerCommand('/compact', 0, actions)).rejects.toThrow('暂无')
  useConversationStore.setState({
    messages: [
      { id: 'user', role: 'user', text: 'Earlier', thinking: '', status: 'complete', error: null },
    ],
  })
  expect(await executeComposerCommand('/compact 保留文件路径', 0, actions)).toBe(true)
  expect(useConversationStore.getState().compact).toHaveBeenCalledExactlyOnceWith('保留文件路径')
})

test('an obsolete skill check cannot submit into a different runtime', async () => {
  let finish!: (value: { name: string; description: string }[]) => void
  vi.mocked(loadComposerCommands).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const pending = executeComposerCommand('/skill:design', 0, actions)
  useConversationStore.setState({ instanceId: 'other' })
  finish([{ name: 'skill:design', description: '' }])
  expect(await pending).toBe(false)
  useConversationStore.setState({ status: 'running' })
  expect(await executeComposerCommand('/new', 0, actions)).toBe(false)
})
