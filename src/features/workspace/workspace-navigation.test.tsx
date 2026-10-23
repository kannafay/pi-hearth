import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import { WorkspaceNavigation } from './workspace-navigation'
import { TooltipProvider } from '@/components/ui/tooltip'

const project = { path: 'D:/projects/hearth', name: 'Hearth' }

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ status: 'ready' })
})

test('the project add button opens creation directly without a menu', async () => {
  const onCreate = vi.fn()
  const user = userEvent.setup()
  render(
    <WorkspaceNavigation
      desktop
      onCreate={onCreate}
      onSettings={vi.fn()}
      onInstructions={vi.fn()}
    />,
  )
  await user.click(screen.getByRole('button', { name: '创建项目' }))
  expect(onCreate).toHaveBeenCalledOnce()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '添加项目' }))
  expect(onCreate).toHaveBeenCalledTimes(2)
})

test('projects expand their sessions and their instruction menu remains usable', async () => {
  useWorkspaceStore.setState({
    projects: [project],
    sessions: [
      {
        path: 'D:/sessions/one.jsonl',
        id: 'one',
        cwd: project.path,
        title: '设计讨论',
        modified: Date.now() - 19 * 60 * 60 * 1000,
        messageCount: 2,
      },
    ],
  })
  const onInstructions = vi.fn()
  const user = userEvent.setup()
  render(
    <WorkspaceNavigation
      desktop
      onCreate={vi.fn()}
      onSettings={vi.fn()}
      onInstructions={onInstructions}
    />,
  )
  const trigger = screen.getByRole('button', { name: 'Hearth' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: '设计讨论' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Hearth 项目菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '项目指令' }))
  expect(onInstructions).toHaveBeenCalledExactlyOnceWith(project)
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('button', { name: /设计讨论/ })).not.toBeInTheDocument()
})

test('sliding filters and session navigation stay usable while a session is connecting', async () => {
  const openSession = vi.fn()
  const newConversation = vi.fn()
  useWorkspaceStore.setState({
    projects: [project],
    projectPath: project.path,
    generalCwd: 'general',
    sessions: [
      {
        path: 'project.jsonl',
        id: 'project',
        cwd: project.path,
        title: '项目会话',
        modified: Date.now(),
        messageCount: 2,
      },
      {
        path: 'chat.jsonl',
        id: 'chat',
        cwd: 'general',
        title: '普通会话',
        modified: Date.now(),
        messageCount: 2,
      },
    ],
    openSession,
    newConversation,
  })
  useConversationStore.setState({ status: 'connecting' })
  const user = userEvent.setup()
  render(
    <WorkspaceNavigation
      desktop
      onCreate={vi.fn()}
      onSettings={vi.fn()}
      onInstructions={vi.fn()}
    />,
  )
  expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true')
  await user.click(screen.getByRole('tab', { name: '聊天' }))
  expect(screen.queryByRole('region', { name: '项目' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '普通会话' }))
  expect(openSession).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('tab', { name: '项目' }))
  expect(screen.queryByRole('button', { name: /普通会话/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '新对话' }))
  expect(newConversation).toHaveBeenCalledWith(null)
})

test('session and project tooltips expose full titles and paths without native title bubbles', async () => {
  const openSession = vi.fn()
  const session = {
    path: 'session.jsonl',
    id: 'session',
    cwd: project.path,
    title: '讨论侧边栏被省略的完整会话标题',
    modified: Date.now() - 19 * 60 * 60 * 1000,
    messageCount: 2,
  }
  useWorkspaceStore.setState({
    projects: [project],
    projectPath: project.path,
    sessions: [session],
    openSession,
  })
  const user = userEvent.setup()
  render(
    <TooltipProvider delay={0}>
      <WorkspaceNavigation
        desktop
        onCreate={vi.fn()}
        onSettings={vi.fn()}
        onInstructions={vi.fn()}
      />
    </TooltipProvider>,
  )
  const row = screen.getByRole('button', { name: session.title })
  expect(row).not.toHaveAttribute('title')
  await user.hover(row)
  const tooltip = await screen.findByRole('tooltip')
  expect(within(tooltip).getByText(session.title)).toBeVisible()
  expect(within(tooltip).getByText('19小时前')).toBeVisible()
  expect(within(tooltip).getByText(project.path)).toBeVisible()
  await user.click(row)
  expect(openSession).toHaveBeenCalledExactlyOnceWith(session)
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  const trigger = screen.getByRole('button', { name: 'Hearth' })
  expect(trigger).not.toHaveAttribute('title')
  await user.hover(trigger)
  expect(within(await screen.findByRole('tooltip')).getByText(project.path)).toBeVisible()
})

test('switching projects and tabs preserves each project expansion independently', async () => {
  const second = { path: 'D:/projects/second', name: 'Second' }
  const session = {
    path: 'second.jsonl',
    id: 'second',
    cwd: second.path,
    title: '第二个项目的聊天',
    modified: 2,
    messageCount: 1,
  }
  useWorkspaceStore.setState({ projects: [project, second], sessions: [session] })
  useWorkspaceStore.getState().setProject(project.path)
  useConversationStore.setState({ connect: vi.fn().mockResolvedValue(undefined) })
  const user = userEvent.setup()
  render(
    <WorkspaceNavigation
      desktop
      onCreate={vi.fn()}
      onSettings={vi.fn()}
      onInstructions={vi.fn()}
    />,
  )
  const first = screen.getByRole('button', { name: 'Hearth' })
  const other = screen.getByRole('button', { name: 'Second' })
  await user.click(other)
  await user.click(screen.getByRole('button', { name: session.title }))
  expect(useWorkspaceStore.getState().projectPath).toBe(second.path)
  expect(first).toHaveAttribute('aria-expanded', 'true')
  expect(other).toHaveAttribute('aria-expanded', 'true')
  await user.click(first)
  await user.click(screen.getByRole('tab', { name: '聊天' }))
  await user.click(screen.getByRole('tab', { name: '全部' }))
  expect(screen.getByRole('button', { name: 'Hearth' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('button', { name: 'Second' })).toHaveAttribute('aria-expanded', 'true')
})

test('pinned chats sort first, archived chats stay hidden and row actions never open the chat', async () => {
  const plain = {
    path: 'plain.jsonl',
    id: 'plain',
    cwd: 'general',
    title: '普通聊天',
    modified: 20,
    messageCount: 2,
  }
  const pinned = { ...plain, path: 'pinned.jsonl', id: 'pinned', title: '置顶聊天', modified: 10 }
  const archived = { ...plain, path: 'archived.jsonl', id: 'archived', title: '已归档聊天' }
  const toggleSessionPinned = vi.fn().mockResolvedValue(undefined)
  const setSessionArchived = vi.fn().mockResolvedValue(true)
  const openSession = vi.fn()
  useWorkspaceStore.setState({
    generalCwd: 'general',
    sessions: [plain, pinned, archived],
    sessionPreferences: {
      'pinned.jsonl': { pinned: true, archived: false },
      'archived.jsonl': { pinned: false, archived: true },
    },
    toggleSessionPinned,
    setSessionArchived,
    openSession,
  })
  const user = userEvent.setup()
  render(
    <WorkspaceNavigation
      desktop
      onCreate={vi.fn()}
      onSettings={vi.fn()}
      onInstructions={vi.fn()}
    />,
  )
  expect(screen.queryByRole('button', { name: archived.title })).not.toBeInTheDocument()
  expect(
    screen
      .getByRole('button', { name: pinned.title })
      .compareDocumentPosition(screen.getByRole('button', { name: plain.title })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: `取消置顶 ${pinned.title}` })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await user.click(screen.getByRole('button', { name: `置顶 ${plain.title}` }))
  await user.click(screen.getByRole('button', { name: `归档 ${plain.title}` }))
  expect(toggleSessionPinned).toHaveBeenCalledExactlyOnceWith(plain)
  expect(setSessionArchived).toHaveBeenCalledExactlyOnceWith(plain, true)
  expect(openSession).not.toHaveBeenCalled()
})

test('only the replying session shows progress and terminal events always clear it', () => {
  const session = {
    path: 'D:/sessions/reply.jsonl',
    id: 'reply',
    cwd: project.path,
    title: '正在进行的讨论',
    modified: Date.now(),
    messageCount: 2,
  }
  useWorkspaceStore.setState({
    projects: [project],
    projectPath: project.path,
    sessions: [session, { ...session, path: 'other.jsonl', id: 'other', title: '其他讨论' }],
  })
  useConversationStore.setState({
    instanceId: 'runtime',
    sessionFile: 'd:\\SESSIONS\\reply.jsonl',
    status: 'connecting',
  })
  render(
    <WorkspaceNavigation
      desktop
      onCreate={vi.fn()}
      onSettings={vi.fn()}
      onInstructions={vi.fn()}
    />,
  )
  expect(screen.queryByRole('status', { name: '正在回复' })).not.toBeInTheDocument()
  act(() => useConversationStore.setState({ status: 'ready' }))
  expect(screen.queryByRole('status', { name: '正在回复' })).not.toBeInTheDocument()

  const event = {
    instanceId: 'runtime',
    projectPath: project.path,
    sessionId: 'reply',
    runId: 'run',
  }
  const start = {
    type: 'run_started' as const,
    message: {
      id: 'run-user',
      role: 'user',
      text: '你好',
      thinking: '',
      status: 'complete',
      error: null,
    },
  }
  act(() => useConversationStore.getState().receive([{ ...event, sequence: 1, data: start }]))
  const progress = screen.getByRole('status', { name: '正在回复' })
  const currentRow = screen.getByRole('button', { name: session.title }).parentElement
  const otherRow = screen.getByRole('button', { name: '其他讨论' }).parentElement
  expect(currentRow).toContainElement(progress)
  expect(otherRow).not.toContainElement(progress)
  act(() => useConversationStore.setState({ status: 'stopping' }))
  expect(screen.getByRole('status', { name: '正在回复' })).toBeInTheDocument()
  act(() =>
    useConversationStore
      .getState()
      .receive([
        { ...event, sequence: 2, data: { type: 'run_finished', status: 'cancelled', error: null } },
      ]),
  )
  expect(screen.queryByRole('status', { name: '正在回复' })).not.toBeInTheDocument()
  act(() => useConversationStore.getState().receive([{ ...event, sequence: 3, data: start }]))
  expect(screen.getByRole('status', { name: '正在回复' })).toBeInTheDocument()
  act(() =>
    useConversationStore
      .getState()
      .receive([{ ...event, sequence: 4, data: { type: 'disconnected', error: '连接已断开' } }]),
  )
  expect(screen.queryByRole('status', { name: '正在回复' })).not.toBeInTheDocument()
})

describe('animated navigation filters', () => {
  const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
  let animations: { finish: () => void; cancel: ReturnType<typeof vi.fn> }[]

  beforeEach(() => {
    animations = []
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => {
        let finish!: () => void
        let reject!: (error: Error) => void
        const finished = new Promise<void>((resolve, fail) => {
          finish = resolve
          reject = fail
        })
        const animation = {
          finished,
          finish,
          cancel: vi.fn(() => reject(new DOMException('Cancelled', 'AbortError'))),
        }
        animations.push(animation)
        return animation as unknown as Animation
      }),
    })
  })

  afterEach(() => {
    if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate)
    else delete (Element.prototype as Partial<Element>).animate
  })

  function renderFilters() {
    const session = {
      path: 'project.jsonl',
      id: 'project',
      cwd: project.path,
      title: '项目会话',
      modified: Date.now(),
      messageCount: 2,
    }
    useWorkspaceStore.setState({
      projects: [project],
      projectPath: project.path,
      generalCwd: 'general',
      sessions: [session, { ...session, path: 'chat.jsonl', cwd: 'general', title: '普通会话' }],
    })
    const rendered = render(
      <WorkspaceNavigation
        desktop
        onCreate={vi.fn()}
        onSettings={vi.fn()}
        onInstructions={vi.fn()}
      />,
    )
    screen.getAllByRole('tab').forEach((tab, index) => {
      vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(new DOMRect(index * 80, 0, 80, 28))
    })
    return {
      ...rendered,
      viewport: rendered.container.querySelector<HTMLDivElement>('[data-scroll-area]')!,
    }
  }

  const select = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))
  const finish = async (index: number) => act(async () => animations[index].finish())
  const keyframes = (index: number) =>
    vi.mocked(Element.prototype.animate).mock.calls[index][0] as Keyframe[]

  test('content slides horizontally in both tab directions', async () => {
    renderFilters()
    select('聊天')
    expect(keyframes(0).at(-1)?.transform).toBe('translateX(-12px)')
    await finish(0)
    expect(keyframes(1)[0].transform).toBe('translateX(12px)')
    await finish(1)

    select('项目')
    expect(keyframes(2).at(-1)?.transform).toBe('translateX(12px)')
    await finish(2)
    expect(keyframes(3)[0].transform).toBe('translateX(-12px)')
  })

  test('rapid reversal follows the latest tab movement before content has changed', async () => {
    renderFilters()
    select('聊天')
    select('项目')
    expect(animations[0].cancel).toHaveBeenCalled()
    expect(keyframes(1).at(-1)?.transform).toBe('translateX(12px)')
    await finish(0)
    expect(screen.getByText('普通会话')).toBeInTheDocument()
    await finish(1)
    expect(keyframes(2)[0].transform).toBe('translateX(-12px)')
    expect(screen.queryByText('普通会话')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '项目' })).toHaveAttribute('aria-selected', 'true')
  })

  test('the tab responds immediately, content waits for slide-out and each tab keeps its scroll', async () => {
    const { viewport } = renderFilters()
    viewport.scrollTop = 160
    fireEvent.scroll(viewport)
    select('聊天')
    expect(screen.getByRole('tab', { name: '聊天' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('项目会话')).toBeInTheDocument()
    expect(viewport).toHaveAttribute('inert')
    await finish(0)
    expect(screen.queryByText('项目会话')).not.toBeInTheDocument()
    expect(viewport).not.toHaveAttribute('inert')
    expect(viewport.scrollTop).toBe(0)
    await finish(1)
    viewport.scrollTop = 72
    fireEvent.scroll(viewport)
    select('全部')
    await finish(2)
    expect(viewport.scrollTop).toBe(160)
    await finish(3)
    select('聊天')
    await finish(4)
    expect(viewport.scrollTop).toBe(72)
  })

  test('rapid selection replaces pending fades and switching during entry uses the latest tab', async () => {
    const { unmount } = renderFilters()
    select('项目')
    select('聊天')
    expect(animations[0].cancel).toHaveBeenCalled()
    await finish(0)
    expect(screen.getByText('项目会话')).toBeInTheDocument()
    await finish(1)
    expect(screen.queryByText('项目会话')).not.toBeInTheDocument()
    select('项目')
    expect(animations[2].cancel).toHaveBeenCalled()
    await finish(3)
    expect(screen.getByText('项目会话')).toBeInTheDocument()
    expect(screen.queryByText('普通会话')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '项目' })).toHaveAttribute('aria-selected', 'true')
    unmount()
    expect(animations[4].cancel).toHaveBeenCalled()
  })

  test('returning to the displayed tab cancels the pending content replacement', async () => {
    renderFilters()
    select('聊天')
    select('全部')
    await finish(0)
    await finish(1)
    expect(screen.getByText('项目会话')).toBeInTheDocument()
    expect(screen.getByText('普通会话')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true')
  })

  test('reduced motion switches immediately without starting a fade', () => {
    const matchMedia = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...matchMedia(query),
      matches: query === '(prefers-reduced-motion: reduce)',
    }))
    renderFilters()
    select('聊天')
    expect(screen.queryByText('项目会话')).not.toBeInTheDocument()
    expect(screen.getByText('普通会话')).toBeInTheDocument()
    expect(animations).toHaveLength(0)
  })

  test('enabling reduced motion during a fade reveals the selected content immediately', () => {
    const matchMedia = window.matchMedia
    const media = Object.assign(new EventTarget(), {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener() {},
      removeListener() {},
    })
    vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      query === media.media ? (media as MediaQueryList) : matchMedia(query),
    )
    renderFilters()
    select('聊天')
    act(() => {
      media.matches = true
      media.dispatchEvent(new Event('change'))
    })
    expect(animations[0].cancel).toHaveBeenCalled()
    expect(animations).toHaveLength(1)
    expect(screen.queryByText('项目会话')).not.toBeInTheDocument()
    expect(screen.getByText('普通会话')).toBeInTheDocument()
  })
})
