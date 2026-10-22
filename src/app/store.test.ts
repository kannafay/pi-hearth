import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from './store'
import { useConversationStore } from '@/features/conversation/store'
import { loadCatalog, addProject } from '@/lib/workspace'
import type { PiEvent, SessionInfo, WorkspaceCatalog } from '@/lib/generated/pi'

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
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith(session.cwd, session.path, {
    force: true,
  })
  vi.mocked(useConversationStore.getState().connect).mockClear()
  useConversationStore.setState({ status: 'running' })
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: [{ ...session, modified: 3 }] })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
})

function finishLocalReply() {
  const message = {
    id: 'local-run-user',
    role: 'user',
    text: '你好',
    thinking: '',
    status: 'complete',
    error: null,
    startedAt: 2000,
  }
  const data: PiEvent['data'][] = [
    { type: 'run_started', message },
    {
      type: 'message_started',
      message: { ...message, id: 'local-reply', role: 'assistant', text: '你好。' },
    },
    { type: 'run_finished', status: 'complete', error: null, finishedAt: 3000 },
  ]
  useConversationStore.getState().receive(
    data.map((data, index) => ({
      data,
      sequence: index + 1,
      instanceId: 'pi-1',
      projectPath: session.cwd,
      sessionId: session.id,
      runId: 'local-run',
    })),
  )
}

test('refresh after a local reply updates the sidebar without reconnecting or clearing the transcript', async () => {
  useWorkspaceStore.setState({ ...catalog, initialized: true, projectPath: session.cwd })
  useConversationStore.setState({ instanceId: 'pi-1', sessionFile: session.path })
  finishLocalReply()
  const messages = useConversationStore.getState().messages
  vi.mocked(loadCatalog).mockResolvedValue({
    ...catalog,
    sessions: [{ ...session, modified: 2800 }],
  })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
  expect(useConversationStore.getState().messages).toBe(messages)
  expect(useConversationStore.getState().status).toBe('ready')
  expect(useWorkspaceStore.getState().sessions[0].modified).toBe(2800)

  vi.mocked(loadCatalog).mockResolvedValue({
    ...catalog,
    sessions: [{ ...session, modified: 4000 }],
  })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(
    session.cwd,
    session.path,
    { force: true },
  )
})

test.each(['ready', 'connecting'] as const)(
  'clicking the current %s session preserves the draft and attachments without reconnecting',
  async (status) => {
    const file = {
      id: 'draft-file',
      name: 'notes.txt',
      kind: 'text',
      mimeType: 'text/plain',
      size: 12,
      preview: null,
    }
    useWorkspaceStore.setState({
      ...catalog,
      selectedSessionPath: session.path,
      projectPath: session.cwd,
      draft: '尚未发送',
      draftAttachments: [file],
    })
    useConversationStore.setState({ sessionFile: session.path.toUpperCase(), status })
    await useWorkspaceStore.getState().openSession(session)
    expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().draft).toBe('尚未发送')
    expect(useWorkspaceStore.getState().draftAttachments).toEqual([file])
  },
)

test('an explicit reload still reconnects the current session', async () => {
  useWorkspaceStore.setState({ ...catalog, projectPath: session.cwd })
  useConversationStore.setState({ sessionFile: session.path })
  await useWorkspaceStore.getState().reloadCurrent()
  expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(
    session.cwd,
    session.path,
    { force: true },
  )
})

test('a refresh started before a fast reply finishes uses the latest local completion marker', async () => {
  useWorkspaceStore.setState({ ...catalog, initialized: true, projectPath: session.cwd })
  useConversationStore.setState({ instanceId: 'pi-1', sessionFile: session.path })
  let finishCatalog!: (catalog: WorkspaceCatalog) => void
  vi.mocked(loadCatalog).mockReturnValue(
    new Promise((resolve) => {
      finishCatalog = resolve
    }),
  )
  const pending = useWorkspaceStore.getState().refresh()
  finishLocalReply()
  finishCatalog({ ...catalog, sessions: [{ ...session, modified: 2800 }] })
  await pending
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
})

test('an in-flight catalog refresh cannot reopen a conversation after the user navigates elsewhere', async () => {
  const other = { ...session, id: 'other', path: 'other.jsonl', modified: 10 }
  useWorkspaceStore.setState({
    ...catalog,
    sessions: [session, other],
    initialized: true,
    projectPath: session.cwd,
  })
  useConversationStore.setState({ instanceId: 'pi-1', sessionFile: session.path })
  let finishCatalog!: (catalog: WorkspaceCatalog) => void
  vi.mocked(loadCatalog).mockReturnValue(
    new Promise((resolve) => {
      finishCatalog = resolve
    }),
  )
  const pending = useWorkspaceStore.getState().refresh()
  await useWorkspaceStore.getState().openSession(other)
  useConversationStore.setState({ instanceId: 'pi-2', sessionFile: other.path })
  vi.mocked(useConversationStore.getState().connect).mockClear()
  finishCatalog({ ...catalog, sessions: [session, { ...other, modified: 20 }] })
  await pending
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().selectedSessionPath).toBe(other.path)
})

test('a catalog refresh cannot reconnect the conversation during a settings change', async () => {
  useWorkspaceStore.setState({ ...catalog, initialized: true, projectPath: session.cwd })
  useConversationStore.setState({ sessionFile: session.path, settingsPending: 'model' })
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: [{ ...session, modified: 2 }] })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
})

test('a changed session cannot hide a disconnected assistant behind an automatic reconnect', async () => {
  useWorkspaceStore.setState({ ...catalog, initialized: true, projectPath: session.cwd })
  useConversationStore.setState({
    sessionFile: session.path,
    status: 'disconnected',
    error: 'Pi 已断开',
  })
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: [{ ...session, modified: 2 }] })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
  expect(useConversationStore.getState().error).toBe('Pi 已断开')
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
