import type { ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useMediaQuery } from '@/app/use-media-query'
import { useConversationStore } from '@/features/conversation/store'
import { controlWindow, listenForWindowFocus } from '@/lib/desktop'
import { WorkspaceShell } from './workspace-shell'

vi.mock('@/lib/desktop', () => ({
  isDesktop: () => true,
  getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
  controlWindow: vi.fn().mockResolvedValue(undefined),
  selectProjectDirectory: vi.fn().mockResolvedValue(null),
  listenForWindowFocus: vi.fn(),
}))

vi.mock('@/app/use-media-query', () => ({ useMediaQuery: vi.fn() }))

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
  vi.mocked(listenForWindowFocus).mockImplementation(async (changed) => {
    changed(true)
    return vi.fn<() => void>()
  })
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

  await user.click(screen.getByRole('button', { name: '项目操作' }))
  await user.click(await screen.findByRole('menuitem', { name: '创建项目' }))
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

test('native window activation updates shell appearance without interrupting an open dialog', async () => {
  let changed!: (focused: boolean) => void
  const unlisten = vi.fn()
  vi.mocked(listenForWindowFocus).mockImplementation(async (handler) => {
    changed = handler
    handler(true)
    return unlisten
  })
  const user = userEvent.setup()
  const { unmount } = render(<WorkspaceShell />)
  const shell = screen.getByRole('banner').closest('.workspace-shell')
  expect(shell).toHaveAttribute('data-window-focused', 'true')
  await user.click(screen.getByRole('button', { name: '设置' }))
  act(() => changed(false))
  expect(shell).toHaveAttribute('data-window-focused', 'false')
  expect(screen.getByRole('dialog', { name: '设置' })).toBeVisible()
  act(() => changed(true))
  expect(shell).toHaveAttribute('data-window-focused', 'true')
  expect(screen.getByRole('dialog', { name: '设置' })).toBeVisible()
  unmount()
  expect(unlisten).toHaveBeenCalledOnce()
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
