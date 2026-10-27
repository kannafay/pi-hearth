import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { DialogLayerProvider } from '@/components/dialog-layers'
import { useConversationStore } from '@/features/conversation/store'
import { sessionKey } from '@/lib/session-preferences'
import { ConversationMenu } from './conversation-menu'

vi.mock('@/lib/desktop', () => ({
  isDesktop: () => true,
}))

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

test.each([null, session.cwd])(
  'conversation menus omit directory actions (%s)',
  async (projectPath) => {
    useWorkspaceStore.setState({ projectPath })
    const user = userEvent.setup()
    renderMenu()
    await openMenu(user)
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      '重命名',
      '置顶',
      '归档',
    ])
  },
)

test('rename and archive wait for the active reply while pinning remains available', async () => {
  useConversationStore.setState({ status: 'running' })
  const user = userEvent.setup()
  renderMenu()
  await openMenu(user)
  expect(screen.getByRole('menuitem', { name: '重命名' })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('menuitem', { name: '归档' })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('menuitem', { name: '置顶' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
})
