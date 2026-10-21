import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from './store'
import { useConversationStore } from '@/features/conversation/store'
import { loadCatalog, addProject } from '@/lib/workspace'
import type { SessionInfo, WorkspaceCatalog } from '@/lib/generated/pi'

vi.mock('@/lib/workspace', () => ({ loadCatalog: vi.fn(), addProject: vi.fn() }))
const session: SessionInfo = {
  path: 'history.jsonl',
  id: 'native-id',
  cwd: 'D:\\项目',
  title: 'CLI history',
  modified: 1,
  messageCount: 3,
}
const catalog: WorkspaceCatalog = {
  projects: [{ path: session.cwd, name: '项目' }],
  sessions: [session],
  generalCwd: 'general',
  selection: { projectPath: null, sessionPath: null },
}
beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ connect: vi.fn().mockResolvedValue(undefined), status: 'ready' })
  vi.mocked(loadCatalog).mockResolvedValue(structuredClone(catalog))
})

test('startup permits a general conversation and initializes only once', async () => {
  await Promise.all([
    useWorkspaceStore.getState().initialize(),
    useWorkspaceStore.getState().initialize(),
  ])
  expect(loadCatalog).toHaveBeenCalledTimes(1)
  expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(null, undefined)
  expect(useWorkspaceStore.getState().projectPath).toBeNull()
})

test('startup restores the selected native session and its project', async () => {
  vi.mocked(loadCatalog).mockResolvedValue({
    ...catalog,
    selection: { projectPath: session.cwd, sessionPath: session.path },
  })
  await useWorkspaceStore.getState().initialize()
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith(session.cwd, session.path)
  expect(useWorkspaceStore.getState().projectPath).toBe(session.cwd)
})

test('projects can contain multiple sessions and each open selects the exact file', async () => {
  const second = { ...session, id: 'second', path: 'second.jsonl' }
  useWorkspaceStore.setState({ ...catalog, sessions: [session, second] })
  await useWorkspaceStore.getState().openSession(second)
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith(session.cwd, second.path)
  expect(useWorkspaceStore.getState().selectedSessionPath).toBe(second.path)
  await useWorkspaceStore.getState().newConversation(null)
  expect(useConversationStore.getState().connect).toHaveBeenLastCalledWith(null)
})

test('external CLI changes refresh idle history and never reopen a running task', async () => {
  useWorkspaceStore.setState({ ...catalog, initialized: true, projectPath: session.cwd })
  useConversationStore.setState({ sessionFile: session.path })
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: [{ ...session, modified: 2 }] })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith(session.cwd, session.path)
  vi.mocked(useConversationStore.getState().connect).mockClear()
  useConversationStore.setState({ status: 'running' })
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: [{ ...session, modified: 3 }] })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
})

test('creating a project uses the returned canonical folder and starts its own session', async () => {
  vi.mocked(addProject).mockResolvedValue({ path: 'D:\\新项目', name: '新项目' })
  await useWorkspaceStore.getState().addProject('D:\\', '新项目')
  expect(addProject).toHaveBeenCalledWith('D:\\', '新项目')
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith('D:\\新项目')
})

test('opening a session during new-chat startup keeps the latest selection', async () => {
  let finishOld!: () => void
  useConversationStore.setState({
    status: 'connecting',
    connect: vi.fn().mockImplementation((_project, file) =>
      file
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            finishOld = resolve
          }),
    ),
  })
  const pending = useWorkspaceStore.getState().newConversation(null)
  await useWorkspaceStore.getState().openSession(session)
  finishOld()
  await pending
  expect(useWorkspaceStore.getState().selectedSessionPath).toBe(session.path)
  expect(useWorkspaceStore.getState().projectPath).toBe(session.cwd)
})
