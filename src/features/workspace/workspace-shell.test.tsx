import { useImperativeHandle, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useMediaQuery } from '@/app/use-media-query'
import { useConversationStore } from '@/features/conversation/store'
import { controlWindow } from '@/lib/desktop'
import type { PiEvent } from '@/lib/generated/pi'
import { WorkspaceShell } from './workspace-shell'

const { resizePanel } = vi.hoisted(() => ({ resizePanel: vi.fn() }))

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

// Keep panel controls observable without requiring browser layout measurement.
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({
    id,
    defaultSize,
    panelRef,
    children,
  }: {
    id?: string
    defaultSize?: number | string
    panelRef?: Ref<PanelImperativeHandle | null>
    children: ReactNode
  }) => {
    const pixels = useRef(Number.parseFloat(String(defaultSize ?? 0)))
    useImperativeHandle(panelRef, () => ({
      collapse: () => {
        pixels.current = 0
      },
      expand: () => {},
      resize: (size) => {
        pixels.current = Number.parseFloat(String(size))
        resizePanel(id, size)
      },
      getSize: () => ({ inPixels: pixels.current, asPercentage: 0 }),
      isCollapsed: () => pixels.current === 0,
    }))
    return <div>{children}</div>
  },
  ResizableHandle: ({
    disableDoubleClick: _disableDoubleClick,
    disabled,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { disableDoubleClick?: boolean; disabled?: boolean }) => (
    <div role="separator" aria-disabled={disabled} {...props} />
  ),
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
  resizePanel.mockClear()
})

test.each([false, true])(
  'local session events update navigation immediately and refresh only at completion (batched: %s)',
  (batched) => {
    const path = 'D:/projects/hearth'
    const refresh = vi.fn().mockResolvedValue(undefined)
    const syncActiveSession = vi.fn(useWorkspaceStore.getState().syncActiveSession)
    useWorkspaceStore.setState({
      projectPath: path,
      projects: [{ path, name: '测试' }],
      refresh,
      syncActiveSession,
    })
    useConversationStore.setState({
      instanceId: 'local',
      sessionId: 'native',
      sessionFile: 'native.jsonl',
      connectionTarget: { projectPath: path, sessionPath: null },
    })
    const view = render(<WorkspaceShell />)
    expect(screen.getByText('暂无会话')).toBeVisible()
    let sequence = 0
    const receive = (data: PiEvent['data'][]) => {
      act(() =>
        useConversationStore.getState().receive(
          data.map((data) => ({
            data,
            sequence: ++sequence,
            instanceId: 'local',
            sessionId: 'native',
            projectPath: path,
            runId: 'run',
          })),
        ),
      )
    }
    const user = {
      id: 'run-user',
      role: 'user',
      text: '新会话立即出现',
      thinking: '',
      status: 'complete',
      error: null,
      startedAt: 2000,
    }
    const start: PiEvent['data'][] = [
      { type: 'run_started', message: user },
      {
        type: 'message_started',
        message: { ...user, id: 'reply', role: 'assistant', text: '', status: 'streaming' },
      },
    ]
    const finish: PiEvent['data'] = {
      type: 'run_finished',
      status: 'complete',
      error: null,
      finishedAt: 3000,
    }
    if (batched) {
      receive([...start, finish])
    } else {
      receive(start)
      expect(screen.queryByText('暂无会话')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '新会话立即出现' })).toBeVisible()
      expect(refresh).not.toHaveBeenCalled()
      syncActiveSession.mockClear()
      for (const delta of ['稳定', '显示'])
        receive([
          {
            type: 'message_delta',
            messageId: 'reply',
            contentIndex: 0,
            kind: 'text',
            delta,
          },
        ])
      expect(syncActiveSession).not.toHaveBeenCalled()
      expect(refresh).not.toHaveBeenCalled()
      receive([finish])
    }
    expect(screen.queryByText('暂无会话')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新会话立即出现' })).toBeVisible()
    expect(refresh).toHaveBeenCalledTimes(1)
    view.unmount()
    act(() => useConversationStore.setState({ lastLocalActivityAt: 4000 }))
    expect(refresh).toHaveBeenCalledTimes(1)
  },
)

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

test('double-clicking the sidebar separator resets its saved width and reopening preserves it', async () => {
  useWorkspaceStore.setState({ navigationWidth: 352 })
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  await user.dblClick(screen.getByRole('separator', { name: '调整侧栏宽度' }))
  expect(resizePanel).toHaveBeenCalledExactlyOnceWith('navigation', '300px')
  expect(useWorkspaceStore.getState().navigationWidth).toBe(300)
  await user.click(screen.getByRole('button', { name: '收起侧栏' }))
  await user.click(screen.getByRole('button', { name: '展开侧栏' }))
  expect(useWorkspaceStore.getState().sidebarOpen).toBe(true)
  expect(useWorkspaceStore.getState().navigationWidth).toBe(300)
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

test('the inspector mounts only one content view and shares its tab across docked and floating layouts', async () => {
  let compact = false
  vi.mocked(useMediaQuery).mockImplementation((query) =>
    query === '(max-width: 1199px)' ? compact : false,
  )
  useWorkspaceStore.setState({ inspectorOpen: true })
  const user = userEvent.setup()
  const view = render(<WorkspaceShell />)
  const contentCount = () => document.querySelectorAll('aside[aria-label="项目查看面板"]').length
  expect(contentCount()).toBe(1)
  await user.click(screen.getByRole('tab', { name: '文件' }))

  compact = true
  view.rerender(<WorkspaceShell />)
  const floating = await screen.findByRole('dialog', { name: '项目文件与变更' })
  expect(contentCount()).toBe(1)
  expect(within(floating).getByRole('tab', { name: '文件' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await user.click(within(floating).getByRole('button', { name: '关闭查看面板' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '打开查看面板' }))
  expect(contentCount()).toBe(1)
  expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true')

  compact = false
  view.rerender(<WorkspaceShell />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(contentCount()).toBe(1)
  expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true')
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
  expect(screen.getByRole('dialog', { name: '新建项目' })).toBeVisible()
  expect(name).toHaveValue('draft-project')
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(workspace).not.toHaveAttribute('inert')
})

test('compact inspector can be opened and closed from the header while the workspace is locked', async () => {
  vi.mocked(useMediaQuery).mockReturnValue(true)
  useWorkspaceStore.setState({ inspectorWidth: 460 })
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  const workspace = screen.getByRole('main').closest('.workspace-body')
  await user.click(screen.getByRole('button', { name: '打开查看面板' }))
  const drawer = await screen.findByRole('dialog', { name: '项目文件与变更' })
  expect(drawer).toBeVisible()
  expect(drawer).toHaveAttribute('data-side', 'right')
  expect(drawer).toHaveStyle({ width: '460px' })
  expect(workspace).toHaveAttribute('inert')
  await user.click(within(drawer).getByRole('button', { name: '关闭查看面板' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(workspace).not.toHaveAttribute('inert')
})

test('narrow windows automatically hide the sidebar without changing its saved width or open preference', async () => {
  let narrow = false
  vi.mocked(useMediaQuery).mockImplementation((query) =>
    query === '(width < 960px)' ? narrow : true,
  )
  useWorkspaceStore.setState({ navigationWidth: 352 })
  const user = userEvent.setup()
  const view = render(<WorkspaceShell />)
  const draft = screen.getByRole('textbox', { name: '消息' })
  expect(screen.queryByRole('button', { name: '关闭侧栏' })).not.toBeInTheDocument()
  await user.type(draft, '缩放时保留草稿')
  await user.click(screen.getByRole('tab', { name: '聊天' }))

  narrow = true
  view.rerender(<WorkspaceShell />)
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '展开侧栏' })).toHaveAttribute('aria-expanded', 'false')
  expect(draft.closest('.workspace-body')).toHaveAttribute('data-sidebar-open', 'false')
  expect(useWorkspaceStore.getState()).toMatchObject({ sidebarOpen: true, navigationWidth: 352 })

  await user.click(screen.getByRole('button', { name: '展开侧栏' }))
  const drawer = await screen.findByRole('dialog', { name: '项目与会话' })
  expect(drawer).toHaveAttribute('data-side', 'left')
  expect(drawer).toHaveStyle({ width: '352px' })
  expect(within(drawer).getByRole('tab', { name: '聊天' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getAllByRole('navigation')).toHaveLength(1)
  expect(draft.closest('.workspace-body')).toHaveAttribute('inert')
  await user.click(within(drawer).getByRole('button', { name: '关闭侧栏' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(draft.closest('.workspace-body')).not.toHaveAttribute('inert')

  narrow = false
  view.rerender(<WorkspaceShell />)
  expect(screen.getByRole('navigation')).toBeVisible()
  expect(screen.queryByRole('button', { name: '关闭侧栏' })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '聊天' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: '消息' })).toBe(draft)
  expect(draft).toHaveValue('缩放时保留草稿')
  expect(useWorkspaceStore.getState()).toMatchObject({ sidebarOpen: true, navigationWidth: 352 })
})

test('floating navigation keeps its tab, dismisses on escape or backdrop, and hands off to other panels', async () => {
  vi.mocked(useMediaQuery).mockReturnValue(true)
  useWorkspaceStore.setState({ sidebarOpen: false })
  const user = userEvent.setup()
  render(<WorkspaceShell />)
  const main = screen.getByRole('main')

  await user.click(screen.getByRole('button', { name: '展开侧栏' }))
  await user.click(screen.getByRole('tab', { name: '聊天' }))
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '展开侧栏' }))
  expect(screen.getByRole('tab', { name: '聊天' })).toHaveAttribute('aria-selected', 'true')
  await user.click(document.querySelector('[data-slot="dialog-overlay"]:not([hidden])')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

  await user.click(screen.getByRole('button', { name: '展开侧栏' }))
  await user.click(screen.getByRole('button', { name: '打开查看面板' }))
  expect(await screen.findByRole('dialog', { name: '项目文件与变更' })).toBeVisible()
  expect(screen.queryByRole('dialog', { name: '项目与会话' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '展开侧栏' }))
  expect(await screen.findByRole('dialog', { name: '项目与会话' })).toBeVisible()
  expect(screen.queryByRole('dialog', { name: '项目文件与变更' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '设置' }))
  expect(await screen.findByRole('dialog', { name: '设置' })).toBeVisible()
  expect(screen.queryByRole('dialog', { name: '项目与会话' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '展开侧栏' })).toBeDisabled()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(main.closest('.workspace-body')).not.toHaveAttribute('inert')
  expect(useWorkspaceStore.getState().sidebarOpen).toBe(false)
})

test('choosing a conversation closes floating navigation and expanding the window preserves a manually hidden sidebar', async () => {
  let narrow = true
  vi.mocked(useMediaQuery).mockImplementation((query) =>
    query === '(width < 960px)' ? narrow : true,
  )
  const openSession = vi.fn().mockResolvedValue(undefined)
  useWorkspaceStore.setState({
    sidebarOpen: false,
    sessions: [
      {
        id: 'native',
        path: 'chat.jsonl',
        cwd: 'C:/chat',
        title: '测试会话',
        modified: 0,
        messageCount: 2,
      },
    ],
    openSession,
  })
  const user = userEvent.setup()
  const view = render(<WorkspaceShell />)
  await user.click(screen.getByRole('button', { name: '展开侧栏' }))
  await user.click(screen.getByRole('button', { name: '测试会话' }))
  expect(openSession).toHaveBeenCalledExactlyOnceWith(useWorkspaceStore.getState().sessions[0])
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  narrow = false
  view.rerender(<WorkspaceShell />)
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(useWorkspaceStore.getState().sidebarOpen).toBe(false)
})

test('resizing across the sidebar breakpoint preserves an in-progress session rename', async () => {
  let narrow = false
  vi.mocked(useMediaQuery).mockImplementation((query) =>
    query === '(width < 960px)' ? narrow : true,
  )
  useWorkspaceStore.setState({
    sessions: [
      {
        id: 'native',
        path: 'chat.jsonl',
        cwd: 'C:/chat',
        title: '原标题',
        modified: 0,
        messageCount: 2,
      },
    ],
  })
  const user = userEvent.setup()
  const view = render(<WorkspaceShell />)
  await user.click(screen.getByRole('button', { name: '原标题 会话菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '重命名' }))
  const title = await screen.findByRole('textbox', { name: '会话标题' })
  await user.clear(title)
  await user.type(title, '未保存的标题')

  for (const next of [true, false, true]) {
    narrow = next
    view.rerender(<WorkspaceShell />)
    expect(screen.getByRole('dialog', { name: '重命名会话' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: '会话标题' })).toBe(title)
    expect(title).toHaveValue('未保存的标题')
  }
  await user.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('main').closest('.workspace-body')).not.toHaveAttribute('inert')
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
