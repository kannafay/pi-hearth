import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useMediaQuery } from '@/app/use-media-query'
import { useConversationStore } from '@/features/conversation/store'
import { controlWindow } from '@/lib/desktop'
import { WorkspaceShell } from './workspace-shell'

vi.mock('@/lib/desktop', () => ({
  isDesktop: () => true,
  getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
  controlWindow: vi.fn().mockResolvedValue(undefined),
  selectProjectDirectory: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/use-media-query', () => ({ useMediaQuery: vi.fn() }))
vi.mock('@/lib/project-directory', () => ({
  resolveProjectDirectory: vi.fn().mockResolvedValue('C:/Documents/Pi Hearth/Projects'),
  listenForProjectFolderDrop: vi.fn().mockResolvedValue(() => {}),
}))

// Layout measurement and the conversation runtime are unrelated to dialog interaction.
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => null,
}))
vi.mock('@/features/conversation/conversation-panel', () => ({
  ConversationPanel: () => <textarea aria-label="消息" />,
}))

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.setState({ initialized: true })
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ status: 'ready' })
  vi.mocked(useMediaQuery).mockReturnValue(false)
  vi.mocked(controlWindow).mockClear()
})

test('header search remains available when the sidebar is collapsed', async () => {
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  const search = screen.getByRole('button', { name: '搜索会话' })
  expect(search.closest('[data-window-header]')).not.toBeNull()
  await user.click(screen.getByRole('button', { name: '收起侧栏' }))
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  await user.click(search)
  expect(await screen.findByRole('dialog', { name: '搜索会话' })).toBeVisible()
  expect(screen.getByRole('combobox', { name: '搜索项目、标题或对话内容' })).toHaveFocus()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(search).toHaveFocus())
})

test('search returns to an empty query after its closing transition and reopening', async () => {
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  await user.click(screen.getByRole('button', { name: '搜索会话' }))
  await user.type(
    await screen.findByRole('combobox', { name: '搜索项目、标题或对话内容' }),
    '临时查询',
  )
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '搜索会话' }))
  expect(await screen.findByRole('combobox', { name: '搜索项目、标题或对话内容' })).toHaveValue('')
  expect(screen.getByText('最近会话')).toBeVisible()
})

test('repeated sidebar toggles preserve its filter and the mounted conversation draft', async () => {
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  await user.click(screen.getByRole('tab', { name: '聊天' }))
  const draft = screen.getByRole('textbox', { name: '消息' })
  await user.type(draft, '保留正在编辑的内容')

  for (let index = 0; index < 2; index++) {
    await user.click(screen.getByRole('button', { name: '收起侧栏' }))
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '展开侧栏' }))
  }

  expect(screen.getByRole('tab', { name: '聊天' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: '消息' })).toBe(draft)
  expect(draft).toHaveValue('保留正在编辑的内容')
})

test('the docked inspector preserves its selected tab when closed and reopened', async () => {
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  await user.click(screen.getByRole('button', { name: '打开查看面板' }))
  const inspector = screen.getByRole('complementary', { name: '项目查看面板' })
  await user.click(within(inspector).getByRole('tab', { name: '文件' }))
  await user.click(within(inspector).getByRole('button', { name: '关闭查看面板' }))
  expect(screen.queryByRole('complementary', { name: '项目查看面板' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '打开查看面板' }))
  expect(screen.getByRole('complementary', { name: '项目查看面板' })).toBe(inspector)
  expect(within(inspector).getByRole('tab', { name: '文件' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('settings blocks the workspace while header controls remain accessible and keep it open', async () => {
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  const workspace = screen.getByRole('main').closest('.workspace-body')
  await user.click(screen.getByRole('button', { name: '设置' }))
  await waitFor(() => expect(screen.getByRole('tab', { name: '外观' })).toHaveFocus())
  expect(workspace).toHaveAttribute('inert')

  const collapse = screen.getByRole('button', { name: '收起侧栏' })
  expect(collapse.closest('[inert], [aria-hidden="true"]')).toBeNull()
  await user.click(collapse)
  expect(useWorkspaceStore.getState().sidebarOpen).toBe(false)
  expect(screen.getByRole('dialog', { name: '设置' })).toBeVisible()

  for (const [name, action] of [
    ['最大化或还原窗口', 'maximize'],
    ['最小化窗口', 'minimize'],
    ['关闭窗口', 'close'],
  ] as const) {
    await user.click(screen.getByRole('button', { name }))
    expect(controlWindow).toHaveBeenLastCalledWith(action)
    expect(screen.getByRole('dialog', { name: '设置' })).toBeVisible()
  }

  screen.getByRole('button', { name: '展开侧栏' }).focus()
  await user.keyboard('{Enter}')
  expect(useWorkspaceStore.getState().sidebarOpen).toBe(true)
  expect(screen.getByRole('dialog', { name: '设置' })).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(workspace).not.toHaveAttribute('inert')
})

test('backdrop dismisses settings and project dialogs, but header clicks preserve project edits', async () => {
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  const workspace = screen.getByRole('main').closest('.workspace-body')
  await user.click(screen.getByRole('button', { name: '设置' }))
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(workspace).not.toHaveAttribute('inert')

  await user.click(screen.getByRole('button', { name: '创建项目' }))
  const name = await screen.findByRole('textbox', { name: '项目名称' })
  await user.type(name, 'draft-project')
  expect(workspace).toHaveAttribute('inert')
  await user.click(screen.getByRole('button', { name: '收起侧栏' }))
  expect(screen.getByRole('dialog', { name: '创建项目' })).toBeVisible()
  expect(name).toHaveValue('draft-project')
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(workspace).not.toHaveAttribute('inert')
})

test('compact inspector can be opened and closed from the header while the workspace is locked', async () => {
  vi.mocked(useMediaQuery).mockReturnValue(true)
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  const workspace = screen.getByRole('main').closest('.workspace-body')
  await user.click(screen.getByRole('button', { name: '打开查看面板' }))
  expect(await screen.findByRole('dialog', { name: '项目文件与变更' })).toBeVisible()
  expect(workspace).toHaveAttribute('inert')
  await user.click(screen.getByRole('button', { name: '收起查看面板' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(workspace).not.toHaveAttribute('inert')
})

test('attachment previews lock only the workspace and closing restores the draft', async () => {
  useWorkspaceStore.setState({
    attachmentPreview: {
      id: 'picture',
      name: 'picture.png',
      kind: 'image',
      mimeType: 'image/png',
      size: 1024,
      preview: 'data:image/png;base64,AAAA',
    },
    draft: '保留草稿',
  })
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  const workspace = screen.getByRole('main').closest('.workspace-body')
  expect(await screen.findByAltText('图片预览')).toBeVisible()
  expect(workspace).toHaveAttribute('inert')
  await user.click(screen.getByRole('button', { name: '收起侧栏' }))
  expect(screen.getByRole('dialog', { name: '图片预览' })).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(workspace).not.toHaveAttribute('inert')
  expect(useWorkspaceStore.getState().draft).toBe('保留草稿')
})
