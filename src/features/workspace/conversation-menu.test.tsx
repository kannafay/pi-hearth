import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { DialogLayerProvider } from '@/components/dialog-layers'
import { useConversationStore } from '@/features/conversation/store'
import { openDirectoryWith, type DirectoryApplication } from '@/lib/desktop'
import { sessionKey } from '@/lib/session-preferences'
import { toast } from '@/lib/toast'
import { ConversationMenu } from './conversation-menu'

vi.mock('@/lib/desktop', () => ({
  isDesktop: () => true,
  openDirectoryWith: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))

const session = {
  id: 'active',
  path: 'active.jsonl',
  cwd: 'D:/项目 & folder',
  title: '当前会话',
  modified: 0,
  messageCount: 2,
}

function renderMenu(onRename = vi.fn()) {
  return render(
    <DialogLayerProvider>
      <ConversationMenu session={session} onRename={onRename} />
    </DialogLayerProvider>,
  )
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  screen.getByRole('button', { name: '会话更多操作' }).focus()
  await user.keyboard('{Enter}')
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  ;(await screen.findByRole('menuitem', { name })).focus()
  await user.keyboard('{Enter}')
}

async function openApplications(user: ReturnType<typeof userEvent.setup>) {
  screen.getByRole('menuitem', { name: '打开方式' }).focus()
  await user.keyboard('{ArrowRight}')
}

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.setState({ projectPath: 'D:/different-project', generalCwd: 'C:/Users/admin' })
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({
    status: 'ready',
    sessionId: session.id,
    sessionFile: session.path,
  })
})

test('rename, pin, and archive act on the active session and reflect its current pin state', async () => {
  const onRename = vi.fn()
  const archive = vi.fn().mockResolvedValue(true)
  const togglePinned = vi.fn(async () => {
    useWorkspaceStore.setState({
      sessionPreferences: { [sessionKey(session.path)!]: { pinned: true, archived: false } },
    })
  })
  useWorkspaceStore.setState({ toggleSessionPinned: togglePinned, setSessionArchived: archive })
  const user = userEvent.setup()
  renderMenu(onRename)
  await openMenu(user)
  await choose(user, '重命名')
  expect(onRename).toHaveBeenCalledExactlyOnceWith(session)
  await openMenu(user)
  await choose(user, '置顶')
  expect(togglePinned).toHaveBeenCalledExactlyOnceWith(session)
  await openMenu(user)
  expect(screen.getByRole('menuitem', { name: '取消置顶' })).toBeVisible()
  await choose(user, '归档')
  expect(archive).toHaveBeenCalledExactlyOnceWith(session, true)
})

test.each<{ label: string; application: DirectoryApplication }>([
  { label: 'VS Code', application: 'vscode' },
  { label: '资源管理器', application: 'explorer' },
  { label: 'Windows 终端', application: 'terminal' },
])('$label opens the current conversation working directory', async ({ label, application }) => {
  const user = userEvent.setup()
  renderMenu()
  await openMenu(user)
  await openApplications(user)
  await choose(user, label)
  expect(openDirectoryWith).toHaveBeenCalledExactlyOnceWith(session.cwd, application)
})

test('rename and archive wait for the active reply while directory actions remain available', async () => {
  useConversationStore.setState({ status: 'running' })
  const user = userEvent.setup()
  renderMenu()
  await openMenu(user)
  expect(screen.getByRole('menuitem', { name: '重命名' })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('menuitem', { name: '归档' })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('menuitem', { name: '打开方式' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('a missing application reports the launch failure through the shared toast', async () => {
  vi.mocked(openDirectoryWith).mockRejectedValueOnce(
    '无法打开 Windows 终端，请确认已安装 Windows Terminal。',
  )
  const user = userEvent.setup()
  renderMenu()
  await openMenu(user)
  await openApplications(user)
  await choose(user, 'Windows 终端')
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(
    '无法打开 Windows 终端，请确认已安装 Windows Terminal。',
  )
})
