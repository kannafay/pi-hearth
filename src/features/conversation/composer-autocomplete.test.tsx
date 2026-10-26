import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { loadComposerCommands, searchProjectFiles } from '@/lib/composer'
import { Composer } from './composer'
import { useConversationStore } from './store'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))
vi.mock('@/lib/composer', () => ({
  loadComposerCommands: vi.fn(),
  searchProjectFiles: vi.fn(),
  compactPi: vi.fn(),
}))
vi.mock('@/lib/attachments', () => ({
  chooseAttachments: vi.fn().mockResolvedValue([]),
  clipboardAttachments: vi.fn().mockResolvedValue([]),
  hasClipboardAttachments: vi.fn().mockResolvedValue(false),
  releaseAttachments: vi.fn(),
  stageFiles: vi.fn(),
  stagePaths: vi.fn(),
  MAX_ATTACHMENTS: 10,
  prepareAttachmentPicker: vi.fn().mockResolvedValue(''),
  listenForAttachmentDrop: vi.fn().mockResolvedValue(() => {}),
}))

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({
    instanceId: 'runtime',
    status: 'ready',
    send: vi.fn().mockResolvedValue(true),
    availableThinkingLevels: ['off', 'high'],
  })
  vi.mocked(loadComposerCommands).mockResolvedValue([
    { name: 'skill:frontend-design', description: 'Design a frontend' },
  ])
  vi.mocked(searchProjectFiles).mockResolvedValue(['src/中文 目录/notes.ts'])
})

test('slash menu merges app actions with loaded skills and keyboard completion does not send', async () => {
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.type(input, '/')
  expect(screen.getByRole('option', { name: /\/new/ })).toBeVisible()
  expect(await screen.findByRole('option', { name: /\/skill:frontend-design/ })).toBeVisible()
  expect(
    within(screen.getByRole('group', { name: '命令' })).getByRole('option', { name: /\/new/ }),
  ).toBeVisible()
  expect(
    within(screen.getByRole('group', { name: '技能' })).getByRole('option', {
      name: /\/skill:frontend-design/,
    }),
  ).toBeVisible()
  await user.keyboard('model{Tab}')
  expect(input).toHaveValue('/model ')
  expect(screen.queryByRole('listbox', { name: '快捷操作' })).not.toBeInTheDocument()
  expect(input).toHaveFocus()
  expect(useConversationStore.getState().send).not.toHaveBeenCalled()
})

test('group headings are skipped during keyboard navigation and empty groups disappear when filtering', async () => {
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.type(input, '/')
  const skill = await screen.findByRole('option', { name: /\/skill:frontend-design/ })
  await user.keyboard('{ArrowUp}')
  expect(skill).toHaveAttribute('aria-selected', 'true')
  expect(input).toHaveAttribute('aria-activedescendant', skill.id)
  await user.keyboard('{ArrowUp}')
  expect(screen.getByRole('option', { name: /\/compact/ })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{ArrowDown}')
  expect(skill).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('skill:')
  expect(await screen.findByRole('group', { name: '技能' })).toBeVisible()
  expect(screen.queryByRole('group', { name: '命令' })).not.toBeInTheDocument()
  await user.keyboard('{Tab}')
  expect(input).toHaveValue('/skill:frontend-design ')
  expect(useConversationStore.getState().send).not.toHaveBeenCalled()
})

test('Enter completes first, then invokes app settings without producing a chat message', async () => {
  const user = userEvent.setup()
  const onSettings = vi.fn()
  render(<Composer onSendStart={() => {}} onSettings={onSettings} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.type(input, '/settings{Enter}')
  expect(input).toHaveValue('/settings ')
  expect(onSettings).not.toHaveBeenCalled()
  await user.keyboard('{Enter}')
  expect(onSettings).toHaveBeenCalledOnce()
  expect(input).toHaveValue('')
  expect(useConversationStore.getState().send).not.toHaveBeenCalled()
})

test('model and thinking commands open the existing selectors', async () => {
  const user = userEvent.setup()
  useConversationStore.setState({ models: [{ provider: 'p', id: 'a', name: 'Alpha' }] })
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.type(input, '/model {Enter}')
  expect(await screen.findByRole('option', { name: 'Alpha' })).toBeVisible()
  await user.keyboard('{Escape}')
  await user.click(input)
  await user.type(input, '/thinking {Enter}')
  expect(await screen.findByRole('option', { name: 'Off' })).toBeVisible()
  expect(useConversationStore.getState().send).not.toHaveBeenCalled()
})

test('inline file completion quotes spaces and preserves text after the caret', async () => {
  const user = userEvent.setup()
  const text = '请看 @note 后面的内容'
  useWorkspaceStore.setState({ draft: text })
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' }) as HTMLTextAreaElement
  await user.click(input)
  const caret = text.indexOf(' 后面的')
  input.setSelectionRange(caret, caret)
  fireEvent.select(input)
  const option = await screen.findByRole('option', { name: /notes.ts/ })
  expect(searchProjectFiles).toHaveBeenLastCalledWith('runtime', 'note')
  await user.click(option)
  expect(input).toHaveValue('请看 @"src/中文 目录/notes.ts" 后面的内容')
  expect(input).toHaveFocus()
  expect(useWorkspaceStore.getState().draftAttachments).toEqual([])
  await user.click(screen.getByRole('button', { name: '发送消息' }))
  expect(useConversationStore.getState().send).toHaveBeenCalledExactlyOnceWith(
    '请看 @"src/中文 目录/notes.ts" 后面的内容',
    [],
  )
})

test('stale searches cannot replace newer results or survive a conversation switch', async () => {
  const user = userEvent.setup()
  let old!: (paths: string[]) => void
  vi.mocked(searchProjectFiles).mockReturnValueOnce(
    new Promise((resolve) => {
      old = resolve
    }),
  )
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.type(input, '@old')
  await waitFor(() => expect(searchProjectFiles).toHaveBeenCalledWith('runtime', 'old'))
  await user.clear(input)
  await user.type(input, '@new')
  expect(await screen.findByRole('option', { name: /notes.ts/ })).toBeVisible()
  await act(async () => old(['obsolete.txt']))
  expect(screen.queryByRole('option', { name: /obsolete/ })).not.toBeInTheDocument()
  act(() => useConversationStore.setState({ instanceId: 'other-runtime', status: 'connecting' }))
  expect(screen.queryByRole('listbox', { name: '项目文件' })).not.toBeInTheDocument()
})

test('Escape closes completion, IME Enter and empty search results never send', async () => {
  const user = userEvent.setup()
  vi.mocked(searchProjectFiles).mockResolvedValue([])
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.type(input, '@missing')
  expect(await screen.findByText('未找到匹配文件')).toBeVisible()
  await user.keyboard('{Enter}')
  expect(useConversationStore.getState().send).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(useConversationStore.getState().send).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(input).toHaveValue('@missing')
})

test('failed searches can be retried while keeping input focus', async () => {
  const user = userEvent.setup()
  vi.mocked(searchProjectFiles).mockRejectedValueOnce('无法搜索')
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.type(input, '@note')
  await user.click(await screen.findByRole('button', { name: '重试' }))
  expect(input).toHaveFocus()
  expect(await screen.findByRole('option', { name: /notes.ts/ })).toBeVisible()
})

test('unknown and disabled skill commands preserve drafts and do not reach the model', async () => {
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.type(input, '/unknown ')
  await user.click(screen.getByRole('button', { name: '发送消息' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('未支持的命令')
  expect(input).toHaveValue('/unknown ')
  await user.clear(input)
  await user.type(input, '/skill:disabled ')
  await user.click(screen.getByRole('button', { name: '发送消息' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('未启用')
  expect(useConversationStore.getState().send).not.toHaveBeenCalled()
})

test('a loaded skill stays on the prompt path and is checked again before send', async () => {
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.type(input, '/skill:frontend-design 做个页面')
  await user.click(screen.getByRole('button', { name: '发送消息' }))
  expect(useConversationStore.getState().send).toHaveBeenCalledExactlyOnceWith(
    '/skill:frontend-design 做个页面',
    [],
  )
})
