import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from './store'
import { emptyConversation, useConversationStore } from '@/features/conversation/store'
import {
  loadCatalog,
  addProject,
  updateProject,
  updateSessionPreference,
  renameSession,
  deleteArchivedSessions,
} from '@/lib/workspace'
import { rememberSession } from '@/features/conversation/session-cache'
import { sessionKey, visibleSessions } from '@/lib/session-preferences'
import type { PiEvent, RuntimeSnapshot, SessionInfo, WorkspaceCatalog } from '@/lib/generated/pi'
import * as pi from '@/lib/pi'
import * as thinkingPreference from '@/features/conversation/thinking-preference'

vi.mock('@/lib/workspace', () => ({
  loadCatalog: vi.fn(),
  addProject: vi.fn(),
  updateProject: vi.fn(),
  updateSessionPreference: vi.fn(),
  renameSession: vi.fn(),
  deleteArchivedSessions: vi.fn(),
}))
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
  sessionPreferences: {},
}
beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ connect: vi.fn().mockResolvedValue(undefined), status: 'ready' })
  vi.mocked(loadCatalog).mockResolvedValue(structuredClone(catalog))
  vi.mocked(renameSession).mockImplementation(async (_path, title) => title)
  vi.mocked(updateSessionPreference).mockImplementation(async (path, preference) => ({
    ...useWorkspaceStore.getState().sessionPreferences,
    [sessionKey(path)!]: preference,
  }))
})

test('unchanged catalog refreshes retain navigation data without hiding real changes', async () => {
  const preferences = { [session.path]: { pinned: true, archived: false } }
  useWorkspaceStore.setState({ ...catalog, sessionPreferences: preferences, initialized: true })
  const before = useWorkspaceStore.getState()
  vi.mocked(loadCatalog).mockResolvedValue(
    structuredClone({ ...catalog, sessionPreferences: preferences }),
  )
  await before.refresh()
  expect(useWorkspaceStore.getState().projects).toBe(before.projects)
  expect(useWorkspaceStore.getState().sessions).toBe(before.sessions)
  expect(useWorkspaceStore.getState().sessionPreferences).toBe(preferences)
  vi.mocked(loadCatalog).mockResolvedValue({
    ...catalog,
    projects: [{ ...catalog.projects[0], name: '更新的项目名' }],
    sessionPreferences: preferences,
  })
  await before.refresh()
  expect(useWorkspaceStore.getState().projects[0].name).toBe('更新的项目名')
  expect(useWorkspaceStore.getState().sessions).toBe(before.sessions)
})

test('opening another session or a new conversation stays available while the current session replies', async () => {
  useWorkspaceStore.setState({ ...catalog, initialized: true })
  useConversationStore.setState({
    status: 'running',
    sessionId: 'running',
    sessionFile: 'running.jsonl',
  })
  const connect = useConversationStore.getState().connect
  await useWorkspaceStore.getState().openSession(session)
  expect(connect).toHaveBeenCalledWith(session.cwd, session.path, { sessionId: session.id })
  await useWorkspaceStore.getState().newConversation(null)
  expect(connect).toHaveBeenCalledTimes(2)
})

test('renaming persists the native title and preserves transcript, selection and ordering metadata', async () => {
  useWorkspaceStore.setState({ ...catalog, selectedSessionPath: session.path })
  const messages = useConversationStore.getState().messages
  await useWorkspaceStore.getState().renameSession(session, '  新标题  ')
  expect(renameSession).toHaveBeenCalledExactlyOnceWith(session.path, '新标题')
  expect(useWorkspaceStore.getState().sessions).toEqual([{ ...session, title: '新标题' }])
  expect(useWorkspaceStore.getState().selectedSessionPath).toBe(session.path)
  expect(useConversationStore.getState().messages).toBe(messages)
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().sessionActionPending).toBeNull()
})

test('a failed rename preserves its old title and releases the action lock', async () => {
  useWorkspaceStore.setState({ sessions: [session] })
  vi.mocked(renameSession).mockRejectedValueOnce(new Error('保存失败'))
  await expect(useWorkspaceStore.getState().renameSession(session, '新标题')).rejects.toThrow(
    '保存失败',
  )
  expect(useWorkspaceStore.getState().sessions).toEqual([session])
  expect(useWorkspaceStore.getState().sessionActionPending).toBeNull()
  await useWorkspaceStore.getState().renameSession(session, '重试成功')
  expect(useWorkspaceStore.getState().sessions[0].title).toBe('重试成功')
})

test('a stale catalog cannot overwrite a newly saved title', async () => {
  useWorkspaceStore.setState({ ...catalog, initialized: true })
  let finish!: (value: WorkspaceCatalog) => void
  vi.mocked(loadCatalog).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const refresh = useWorkspaceStore.getState().refresh()
  await useWorkspaceStore.getState().renameSession(session, '保存的新标题')
  finish(catalog)
  await refresh
  expect(useWorkspaceStore.getState().sessions[0].title).toBe('保存的新标题')
})

test('the responding session cannot be renamed while other session titles remain editable', async () => {
  useConversationStore.setState({ status: 'running', sessionFile: session.path })
  await expect(useWorkspaceStore.getState().renameSession(session, '新标题')).rejects.toThrow(
    '回复结束',
  )
  expect(renameSession).not.toHaveBeenCalled()
  await useWorkspaceStore.getState().renameSession({ ...session, path: 'other.jsonl' }, '其他会话')
  expect(renameSession).toHaveBeenCalledExactlyOnceWith('other.jsonl', '其他会话')
})

test('deleting archived sessions removes their catalog entries and cached transcripts', async () => {
  useWorkspaceStore.setState({ sessions: [session], selectedSessionPath: session.path })
  useConversationStore.setState({
    sessionId: session.id,
    sessionFile: 'logical-alias.jsonl',
    instanceId: 'cached',
  })
  useConversationStore.setState({
    sessionCache: rememberSession(new Map(), useConversationStore.getState()),
  })
  expect(useConversationStore.getState().sessionCache.has(`id:${session.id}`)).toBe(true)
  vi.mocked(deleteArchivedSessions).mockResolvedValue({ ...catalog, sessions: [] })

  expect(await useWorkspaceStore.getState().deleteArchivedSessions([session.path])).toBe(true)
  expect(deleteArchivedSessions).toHaveBeenCalledExactlyOnceWith([session.path])
  expect(useWorkspaceStore.getState().sessions).toEqual([])
  expect(useWorkspaceStore.getState().selectedSessionPath).toBeNull()
  expect(useWorkspaceStore.getState().sessionActionPending).toBeNull()
  expect(useConversationStore.getState().sessionCache.has(`id:${session.id}`)).toBe(false)
})

test('a partially failed deletion reloads the remaining catalog and releases the action lock', async () => {
  const remaining = { ...session, path: 'remaining.jsonl' }
  useWorkspaceStore.setState({ sessions: [session, remaining] })
  vi.mocked(deleteArchivedSessions).mockRejectedValue('部分文件无法删除')
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: [remaining] })

  expect(
    await useWorkspaceStore.getState().deleteArchivedSessions([session.path, remaining.path]),
  ).toBe(false)
  expect(useWorkspaceStore.getState().sessions).toEqual([remaining])
  expect(useWorkspaceStore.getState().error).toBe('部分文件无法删除')
  expect(useWorkspaceStore.getState().sessionActionPending).toBeNull()
})

test('startup permits a general conversation and initializes only once', async () => {
  await Promise.all([
    useWorkspaceStore.getState().initialize(),
    useWorkspaceStore.getState().initialize(),
  ])
  expect(loadCatalog).toHaveBeenCalledTimes(1)
  expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(null, undefined, {
    defaultModel: null,
    defaultPermission: 'ask',
  })
  expect(useWorkspaceStore.getState().projectPath).toBeNull()
})

test('startup restores the selected native session and its project', async () => {
  vi.mocked(loadCatalog).mockResolvedValue({
    ...catalog,
    selection: { projectPath: session.cwd, sessionPath: session.path },
  })
  await useWorkspaceStore.getState().initialize()
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith(session.cwd, session.path, {
    sessionId: session.id,
  })
  expect(useWorkspaceStore.getState().projectPath).toBe(session.cwd)
  expect(useWorkspaceStore.getState().expandedProjects[sessionKey(session.cwd)!]).toBe(true)
})

test.each([session.path, null])(
  'startup preserves saved project collapse when restoring session %s',
  async (sessionPath) => {
    const expandedProjects = { [sessionKey(session.cwd)!]: false, 'd:/other': true }
    useWorkspaceStore.setState({ expandedProjects })
    vi.mocked(loadCatalog).mockResolvedValue({
      ...catalog,
      selection: { projectPath: session.cwd, sessionPath },
    })

    await useWorkspaceStore.getState().initialize()

    expect(useWorkspaceStore.getState().projectPath).toBe(session.cwd)
    expect(useWorkspaceStore.getState().expandedProjects).toBe(expandedProjects)
  },
)

test('projects can contain multiple sessions and each open selects the exact file', async () => {
  const second = { ...session, id: 'second', path: 'second.jsonl' }
  useWorkspaceStore.setState({ ...catalog, sessions: [session, second] })
  await useWorkspaceStore.getState().openSession(second)
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith(session.cwd, second.path, {
    sessionId: second.id,
  })
  expect(useWorkspaceStore.getState().selectedSessionPath).toBe(second.path)
  await useWorkspaceStore.getState().newConversation(null)
  expect(useConversationStore.getState().connect).toHaveBeenLastCalledWith(null, undefined, {
    defaultModel: null,
    defaultPermission: 'ask',
  })
})

test('external CLI changes refresh idle history and never reopen a running task', async () => {
  useWorkspaceStore.setState({ ...catalog, initialized: true, projectPath: session.cwd })
  useConversationStore.setState({ sessionFile: session.path })
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: [{ ...session, modified: 2 }] })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith(session.cwd, session.path, {
    force: true,
    sessionId: session.id,
  })
  vi.mocked(useConversationStore.getState().connect).mockClear()
  useConversationStore.setState({ status: 'running' })
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: [{ ...session, modified: 3 }] })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
})

test.each(['connecting', 'ready'] as const)(
  'repeated new-chat clicks preserve the %s session, selection, draft and attachments',
  async (status) => {
    const attachments = [
      {
        id: 'image',
        name: 'photo.png',
        kind: 'image',
        mimeType: 'image/png',
        size: 1,
        preview: null,
      },
    ]
    useWorkspaceStore.setState({
      projectPath: session.cwd,
      selectedSessionPath: 'new.jsonl',
      draft: '保留正在输入的内容',
      draftAttachments: attachments,
    })
    useConversationStore.setState({
      connectionTarget: { projectPath: session.cwd, sessionPath: null },
      instanceId: status === 'ready' ? 'new-runtime' : null,
      sessionFile: status === 'ready' ? 'new.jsonl' : null,
      status,
    })
    const before = useWorkspaceStore.getState()
    await useWorkspaceStore.getState().newConversation(session.cwd.toLowerCase())
    expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState()).toBe(before)
  },
)

test('choosing another project preserves the unsent draft and attachments', async () => {
  const attachments = [
    { id: 'file', name: 'notes.txt', kind: 'text', mimeType: 'text/plain', size: 1, preview: null },
  ]
  useWorkspaceStore.setState({ draft: '分析这个项目', draftAttachments: attachments })
  useConversationStore.setState({
    connectionTarget: { projectPath: null, sessionPath: null },
    instanceId: 'new-runtime',
    status: 'ready',
  })
  await useWorkspaceStore.getState().newConversation(session.cwd, { preserveDraft: true })
  expect(useWorkspaceStore.getState().projectPath).toBe(session.cwd)
  expect(useWorkspaceStore.getState().draft).toBe('分析这个项目')
  expect(useWorkspaceStore.getState().draftAttachments).toBe(attachments)
  expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(
    session.cwd,
    undefined,
    { defaultModel: null, defaultPermission: 'ask' },
  )
})

test('an empty saved conversation still creates a separate new chat', async () => {
  useWorkspaceStore.setState({ projectPath: session.cwd })
  useConversationStore.setState({
    connectionTarget: { projectPath: session.cwd, sessionPath: session.path },
    instanceId: 'saved-runtime',
    status: 'ready',
  })
  await useWorkspaceStore.getState().newConversation(session.cwd)
  expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(
    session.cwd,
    undefined,
    { defaultModel: null, defaultPermission: 'ask' },
  )
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

test('a blank or still-connecting draft never creates a sidebar session', () => {
  useWorkspaceStore.setState({ projectPath: session.cwd })
  useConversationStore.setState({
    instanceId: 'pi-1',
    sessionId: session.id,
    sessionFile: session.path,
  })
  useWorkspaceStore.getState().syncActiveSession()
  expect(useWorkspaceStore.getState().sessions).toEqual([])
  finishLocalReply()
  useConversationStore.setState({ status: 'connecting' })
  useWorkspaceStore.getState().syncActiveSession()
  expect(useWorkspaceStore.getState().sessions).toEqual([])
})

test('a native user message enters the project sidebar before its first reply finishes', () => {
  useWorkspaceStore.setState({ projectPath: session.cwd })
  useConversationStore.setState({
    instanceId: 'pi-1',
    sessionId: session.id,
    sessionFile: session.path,
    connectionTarget: { projectPath: session.cwd, sessionPath: null },
  })
  useConversationStore.getState().receive([
    {
      instanceId: 'pi-1',
      sessionId: session.id,
      projectPath: session.cwd,
      runId: 'local-run',
      sequence: 1,
      data: {
        type: 'run_started',
        message: {
          id: 'local-run-user',
          role: 'user',
          text: '你好',
          thinking: '',
          status: 'complete',
          error: null,
          startedAt: 2000,
        },
      },
    },
  ])
  useWorkspaceStore.getState().syncActiveSession()
  expect(useWorkspaceStore.getState().sessions).toEqual([
    { ...session, title: '你好', modified: 2000, messageCount: 1 },
  ])
  expect(useWorkspaceStore.getState().selectedSessionPath).toBe(session.path)
  expect(loadCatalog).not.toHaveBeenCalled()
})

test('local metadata preserves catalog titles, preferences and path identity without duplicates', () => {
  useWorkspaceStore.setState({
    ...catalog,
    projectPath: session.cwd,
    sessionPreferences: { [session.path]: { pinned: true, archived: false } },
  })
  useConversationStore.setState({
    instanceId: 'pi-1',
    sessionId: session.id,
    sessionFile: session.path.toUpperCase(),
  })
  finishLocalReply()
  useWorkspaceStore.getState().syncActiveSession()
  expect(useWorkspaceStore.getState().sessions).toEqual([{ ...session, modified: 3000 }])
  expect(useWorkspaceStore.getState().sessionPreferences[session.path]?.pinned).toBe(true)
})

test('restoring settings after a new conversation arrives does not move the opened chat before or after refresh', async () => {
  const older = { ...session, modified: 1000, messageCount: 2 }
  const newer = { ...older, id: 'new', path: 'new.jsonl', title: '新会话', modified: 2000 }
  const snapshot: RuntimeSnapshot = {
    queuedMessages: [],
    instanceId: 'restored',
    sessionId: older.id,
    sessionFile: older.path,
    projectPath: older.cwd,
    readOnly: null,
    permissionMode: 'ask',
    activeRunId: null,
    sequence: 42,
    model: null,
    models: [],
    thinkingLevel: 'low',
    availableThinkingLevels: ['low', 'high'],
    messages: [
      {
        id: 'old-user',
        role: 'user',
        text: '旧问题',
        thinking: '',
        status: 'complete',
        error: null,
        timestamp: 900,
        startedAt: 900,
        finishedAt: 1500,
      },
      {
        id: 'old-reply',
        role: 'assistant',
        text: '旧回复',
        thinking: '',
        status: 'complete',
        error: null,
        timestamp: 1000,
      },
    ],
    tools: [],
    timeline: [],
  }
  useWorkspaceStore.setState({
    ...catalog,
    sessions: [newer, older],
    initialized: true,
    projectPath: older.cwd,
    selectedSessionPath: older.path,
  })
  useConversationStore.setState({ ...snapshot, status: 'ready' })
  const order = () => {
    const state = useWorkspaceStore.getState()
    return visibleSessions(state.sessions, state.sessionPreferences, state.sessionOrder).map(
      (item) => item.id,
    )
  }
  expect(order()).toEqual([newer.id, older.id])
  vi.spyOn(Date, 'now').mockReturnValue(5000)
  vi.spyOn(pi, 'setPiThinkingLevel').mockResolvedValue(snapshot)
  vi.spyOn(thinkingPreference, 'saveThinkingPreference').mockResolvedValue()
  await useConversationStore.getState().changeThinkingLevel('low')
  useWorkspaceStore.getState().syncActiveSession()
  expect(order()).toEqual([newer.id, older.id])
  expect(useWorkspaceStore.getState().sessions.find((item) => item.id === older.id)?.modified).toBe(
    1000,
  )
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: [newer, older] })
  await useWorkspaceStore.getState().refresh()
  expect(order()).toEqual([newer.id, older.id])
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
})

test('restored completion times do not reorder chats, while a real new message still updates activity', () => {
  const older = { ...session, modified: 1000, messageCount: 1 }
  const newer = { ...older, id: 'new', path: 'new.jsonl', modified: 2000 }
  useWorkspaceStore.setState({
    ...catalog,
    sessions: [newer, older],
    selectedSessionPath: older.path,
  })
  useConversationStore.setState({
    instanceId: 'restored',
    sessionId: older.id,
    sessionFile: older.path,
    lastLocalActivityAt: null,
    messages: [
      {
        id: 'old-user',
        role: 'user',
        text: '旧问题',
        thinking: '',
        status: 'complete',
        error: null,
        timestamp: 1000,
        startedAt: 1000,
        finishedAt: 3500,
      },
    ],
  })
  useWorkspaceStore.getState().syncActiveSession()
  expect(visibleSessions(useWorkspaceStore.getState().sessions, {}).map((item) => item.id)).toEqual(
    [newer.id, older.id],
  )
  useConversationStore.setState({
    messages: [
      ...useConversationStore.getState().messages,
      {
        id: 'new-user',
        role: 'user',
        text: '新问题',
        thinking: '',
        status: 'complete',
        error: null,
        timestamp: 4000,
      },
    ],
  })
  useWorkspaceStore.getState().syncActiveSession()
  expect(visibleSessions(useWorkspaceStore.getState().sessions, {}).map((item) => item.id)).toEqual(
    [older.id, newer.id],
  )
  expect(
    visibleSessions(useWorkspaceStore.getState().sessions, {}, [newer.path, older.path]).map(
      (item) => item.id,
    ),
  ).toEqual([newer.id, older.id])
})

test.each([session.cwd, 'general'])(
  'activity in %s survives catalog rollback and only a new action overrides later dragging',
  async (cwd) => {
    const older = { ...session, cwd, modified: 1000 }
    const newer = { ...older, id: 'new', path: 'new.jsonl', modified: 2000 }
    const sessions = [newer, older]
    useWorkspaceStore.setState({
      ...catalog,
      initialized: true,
      sessions,
      sessionOrder: [newer.path, older.path],
    })
    useConversationStore.setState({
      instanceId: 'runtime',
      sessionId: older.id,
      sessionFile: older.path,
      connectionTarget: { projectPath: cwd === 'general' ? null : cwd, sessionPath: older.path },
      messages: [
        {
          id: 'old-user',
          role: 'user',
          text: 'Task',
          thinking: '',
          status: 'complete',
          error: null,
          timestamp: 1000,
        },
        {
          id: 'summary',
          role: 'compactionSummary',
          text: 'Summary',
          thinking: '',
          status: 'complete',
          error: null,
          timestamp: 9000,
        },
      ],
    })
    const order = () => {
      const state = useWorkspaceStore.getState()
      return visibleSessions(state.sessions, state.sessionPreferences, state.sessionOrder).map(
        (item) => item.id,
      )
    }
    useWorkspaceStore.getState().syncActiveSession()
    expect(order()).toEqual([newer.id, older.id])
    useWorkspaceStore.getState().promoteSession(useConversationStore.getState())
    expect(order()).toEqual([older.id, newer.id])
    vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions })
    await useWorkspaceStore.getState().refresh()
    expect(order()).toEqual([older.id, newer.id])
    useWorkspaceStore.getState().reorderNavigation('session', newer.path, older.path, 'before')
    const manual = useWorkspaceStore.getState().sessionOrder
    useWorkspaceStore.getState().syncActiveSession()
    await useWorkspaceStore.getState().refresh()
    expect(useWorkspaceStore.getState().sessionOrder).toBe(manual)
    expect(order()).toEqual([newer.id, older.id])
    useWorkspaceStore.getState().promoteSession(useConversationStore.getState())
    expect(order()).toEqual([older.id, newer.id])
    expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
  },
)

test('new catalog activity updates manual order by recency and unchanged refreshes retain a later drag', async () => {
  const sessions = ['a', 'b', 'c'].map((id, index) => ({
    ...session,
    id,
    path: `${id}.jsonl`,
    modified: 100 - index,
  }))
  useWorkspaceStore.setState({
    ...catalog,
    initialized: true,
    sessions,
    sessionOrder: sessions.map((item) => item.path),
  })
  const changed = sessions.map((item) => ({
    ...item,
    modified: item.id === 'c' ? 3000 : item.id === 'b' ? 2000 : item.modified,
  }))
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: changed })
  await useWorkspaceStore.getState().refresh()
  expect(useWorkspaceStore.getState().sessionOrder).toEqual(['c.jsonl', 'b.jsonl', 'a.jsonl'])
  useWorkspaceStore.getState().reorderNavigation('session', 'a.jsonl', 'c.jsonl', 'before')
  const manual = useWorkspaceStore.getState().sessionOrder
  await useWorkspaceStore.getState().refresh()
  expect(useWorkspaceStore.getState().sessionOrder).toBe(manual)
  expect(manual).toEqual(['a.jsonl', 'c.jsonl', 'b.jsonl'])
})

test('a new session stays selected through local events and catalog refresh with a Windows path alias', async () => {
  const native = {
    ...session,
    path: 'C:/Users/admin/AppData/Local/Packages/App/LocalCache/Local/hearth/sessions/new.jsonl',
  }
  const runtimePath = 'C:/Users/admin/AppData/Local/hearth/sessions/new.jsonl'
  useWorkspaceStore.setState({
    ...catalog,
    initialized: true,
    sessions: [native],
    projectPath: session.cwd,
  })
  useConversationStore.setState({
    instanceId: 'pi-1',
    sessionId: native.id,
    sessionFile: runtimePath,
  })
  finishLocalReply()
  useWorkspaceStore.getState().syncActiveSession()
  expect(useWorkspaceStore.getState().sessions).toEqual([{ ...native, modified: 3000 }])
  expect(useWorkspaceStore.getState().selectedSessionPath).toBe(native.path)
  vi.mocked(loadCatalog).mockResolvedValue({
    ...catalog,
    sessions: [{ ...native, modified: 3000 }],
  })
  await useWorkspaceStore.getState().refresh()
  expect(useWorkspaceStore.getState().selectedSessionPath).toBe(native.path)
  await useWorkspaceStore.getState().openSession(native)
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
})

test('a general conversation uses its connection target instead of a stale selected project', () => {
  useWorkspaceStore.setState({ projectPath: session.cwd, generalCwd: 'general' })
  useConversationStore.setState({
    instanceId: 'pi-1',
    sessionId: session.id,
    sessionFile: session.path,
    connectionTarget: { projectPath: null, sessionPath: null },
  })
  finishLocalReply()
  useWorkspaceStore.getState().syncActiveSession()
  expect(useWorkspaceStore.getState().sessions[0].cwd).toBe('general')
})

test('completion queues a fresh catalog behind an older request without losing the local session', async () => {
  useWorkspaceStore.setState({
    ...catalog,
    sessions: [],
    initialized: true,
    projectPath: session.cwd,
  })
  useConversationStore.setState({
    instanceId: 'pi-1',
    sessionId: session.id,
    sessionFile: session.path,
  })
  let finish!: (catalog: WorkspaceCatalog) => void
  vi.mocked(loadCatalog)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    .mockResolvedValueOnce({ ...catalog, sessions: [{ ...session, modified: 2800 }] })
  const pending = useWorkspaceStore.getState().refresh()
  finishLocalReply()
  useWorkspaceStore.getState().syncActiveSession()
  await useWorkspaceStore.getState().refresh()
  await useWorkspaceStore.getState().refresh()
  expect(useWorkspaceStore.getState().sessions[0].title).toBe('你好')
  finish({ ...catalog, sessions: [] })
  await pending
  expect(loadCatalog).toHaveBeenCalledTimes(2)
  expect(useWorkspaceStore.getState().sessions).toEqual([{ ...session, modified: 2800 }])
  expect(useWorkspaceStore.getState().refreshRequested).toBe(false)
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
})

test('periodic catalogs retain an active new session until persistence but respect idle deletions', async () => {
  useWorkspaceStore.setState({ ...catalog, initialized: true, projectPath: session.cwd })
  useConversationStore.setState({
    instanceId: 'pi-1',
    sessionId: session.id,
    sessionFile: session.path,
    status: 'running',
  })
  vi.mocked(loadCatalog).mockResolvedValue({ ...catalog, sessions: [] })
  await useWorkspaceStore.getState().refresh()
  expect(useWorkspaceStore.getState().sessions).toEqual([session])
  useConversationStore.setState({ status: 'ready' })
  await useWorkspaceStore.getState().refresh()
  expect(useWorkspaceStore.getState().sessions).toEqual([])
})

test.each([false, true])(
  'a delayed catalog cannot move a replying session behind a newer chat (background: %s)',
  async (background) => {
    const active = { ...session, modified: 3000, messageCount: 3 }
    const newer = { ...session, id: 'new', path: 'new.jsonl', modified: 2000 }
    const live = {
      ...emptyConversation,
      instanceId: 'active-runtime',
      sessionId: active.id,
      sessionFile: active.path,
      status: 'running' as const,
      activeRunId: 'run',
    }
    useWorkspaceStore.setState({
      ...catalog,
      sessions: [active, newer],
      initialized: true,
      projectPath: session.cwd,
    })
    useConversationStore.setState(
      background
        ? {
            instanceId: 'new-runtime',
            sessionId: newer.id,
            sessionFile: newer.path,
            status: 'ready',
            backgroundSessions: new Map([
              [live.instanceId, { data: live, projectPath: session.cwd }],
            ]),
          }
        : live,
    )
    vi.mocked(loadCatalog).mockResolvedValue({
      ...catalog,
      sessions: [newer, { ...active, modified: 1000, messageCount: 1 }],
    })
    await useWorkspaceStore.getState().refresh()
    const state = useWorkspaceStore.getState()
    expect(
      visibleSessions(state.sessions, state.sessionPreferences).map((item) => item.id),
    ).toEqual([active.id, newer.id])
    expect(state.sessions.find((item) => item.id === active.id)).toMatchObject({
      modified: 3000,
      messageCount: 3,
    })
  },
)

test('completion during startup connection runs its queued catalog as soon as startup finishes', async () => {
  let connected!: () => void
  vi.mocked(useConversationStore.getState().connect).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        connected = resolve
      }),
  )
  vi.mocked(loadCatalog).mockResolvedValueOnce({ ...catalog, sessions: [] })
  const startup = useWorkspaceStore.getState().initialize()
  await vi.waitFor(() => expect(connected).toBeTypeOf('function'))
  useConversationStore.setState({
    instanceId: 'pi-1',
    sessionId: session.id,
    sessionFile: session.path,
    connectionTarget: { projectPath: session.cwd, sessionPath: null },
  })
  finishLocalReply()
  useWorkspaceStore.getState().syncActiveSession()
  await useWorkspaceStore.getState().refresh()
  connected()
  await startup
  expect(loadCatalog).toHaveBeenCalledTimes(2)
  expect(useWorkspaceStore.getState().sessions).toEqual([session])
  expect(useWorkspaceStore.getState().loading).toBe(false)
})

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
    { force: true, sessionId: session.id },
  )
})

test('restoring thinking preferences does not make the catalog reconnect a resident session', async () => {
  const snapshot: RuntimeSnapshot = {
    queuedMessages: [],
    instanceId: 'resident-pi',
    permissionMode: 'ask',
    projectPath: session.cwd,
    sessionFile: session.path,
    sessionId: session.id,
    readOnly: null,
    activeRunId: null,
    sequence: 42,
    model: { provider: 'test', id: 'model', name: 'Model' },
    models: [],
    thinkingLevel: 'low',
    availableThinkingLevels: ['low', 'high'],
    messages: [],
    tools: [],
    timeline: [],
  }
  useWorkspaceStore.setState({ ...catalog, initialized: true, projectPath: session.cwd })
  useConversationStore.setState({ ...snapshot, status: 'ready' })
  vi.spyOn(Date, 'now').mockReturnValue(2000)
  vi.spyOn(pi, 'setPiThinkingLevel').mockResolvedValue(snapshot)
  vi.spyOn(thinkingPreference, 'saveThinkingPreference').mockResolvedValue()
  await useConversationStore.getState().changeThinkingLevel('low')
  vi.mocked(loadCatalog).mockResolvedValue({
    ...catalog,
    sessions: [{ ...session, modified: 1999 }],
  })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
  expect(useConversationStore.getState().instanceId).toBe('resident-pi')
  vi.mocked(loadCatalog).mockResolvedValue({
    ...catalog,
    sessions: [{ ...session, modified: 2500 }],
  })
  await useWorkspaceStore.getState().refresh()
  expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(
    session.cwd,
    session.path,
    { force: true, sessionId: session.id },
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
    { force: true, sessionId: session.id },
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
  await useWorkspaceStore.getState().addProject({
    sourcePath: null,
    name: '新项目',
    instructions: 'Project rules',
    expectedInstructions: '',
  })
  expect(addProject).toHaveBeenCalledWith({
    sourcePath: null,
    name: '新项目',
    parentPath: '',
    instructions: 'Project rules',
    expectedInstructions: '',
  })
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith('D:\\新项目', undefined, {
    defaultModel: null,
    defaultPermission: 'ask',
  })
})

test('adding an existing folder updates its independent project name without duplicating it', async () => {
  useWorkspaceStore.setState({ projects: [{ path: 'D:/source', name: 'source' }] })
  vi.mocked(addProject).mockResolvedValue({ path: 'D:\\source', name: '设计讨论' })
  await useWorkspaceStore.getState().addProject({ sourcePath: 'D:/source', name: '设计讨论' })
  expect(useWorkspaceStore.getState().projects).toEqual([{ path: 'D:\\source', name: '设计讨论' }])
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith('D:\\source', undefined, {
    defaultModel: null,
    defaultPermission: 'ask',
  })
})

test('project creation uses the latest directory preference while its database write is pending', async () => {
  useWorkspaceStore.setState({ projectsDirectory: 'D:/New Location' })
  vi.mocked(addProject).mockResolvedValue({ path: 'D:/New Location/New', name: 'New' })
  await useWorkspaceStore.getState().addProject({ sourcePath: null, name: 'New' })
  expect(addProject).toHaveBeenCalledWith({
    sourcePath: null,
    name: 'New',
    parentPath: 'D:/New Location',
  })
})

test('renaming a project preserves its source, order, pins, sessions and current connection', async () => {
  useWorkspaceStore.setState({
    ...catalog,
    projectPath: session.cwd,
    selectedSessionPath: session.path,
    pinnedProjects: [session.cwd],
    projectOrder: [session.cwd],
  })
  const project = { path: session.cwd, name: 'Renamed' }
  vi.mocked(updateProject).mockResolvedValueOnce(project)
  await useWorkspaceStore.getState().updateProject({ path: session.cwd, name: project.name })
  expect(updateProject).toHaveBeenCalledExactlyOnceWith({ path: session.cwd, name: project.name })
  expect(useWorkspaceStore.getState()).toMatchObject({
    projects: [project],
    projectPath: session.cwd,
    selectedSessionPath: session.path,
    sessions: [session],
    pinnedProjects: [session.cwd],
    projectOrder: [session.cwd],
    sessionActionPending: null,
  })
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
})

test('saving changed instructions reloads only the current project and failed saves retain its name', async () => {
  useWorkspaceStore.setState({ ...catalog, projectPath: session.cwd })
  useConversationStore.setState({ sessionFile: session.path })
  vi.mocked(updateProject).mockRejectedValueOnce(new Error('外部修改'))
  const options = {
    path: session.cwd,
    name: 'Saved',
    instructions: 'New',
    expectedInstructions: '',
  }
  await expect(useWorkspaceStore.getState().updateProject(options)).rejects.toThrow('外部修改')
  expect(useWorkspaceStore.getState().projects).toEqual(catalog.projects)
  expect(useWorkspaceStore.getState().sessionActionPending).toBeNull()
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
  vi.mocked(updateProject).mockResolvedValueOnce({ path: session.cwd, name: 'Saved' })
  await useWorkspaceStore.getState().updateProject(options)
  expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(
    session.cwd,
    session.path,
    { force: true, sessionId: session.id },
  )
  vi.mocked(useConversationStore.getState().connect).mockClear()
  vi.mocked(updateProject).mockResolvedValueOnce({ path: 'D:/other', name: 'Other' })
  await useWorkspaceStore.getState().updateProject({ ...options, path: 'D:/other' })
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
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

test('pinning and archiving persist independently and another session can be archived without reconnecting', async () => {
  useWorkspaceStore.setState({ ...catalog })
  useConversationStore.setState({ sessionFile: 'current.jsonl' })
  await useWorkspaceStore.getState().toggleSessionPinned(session)
  expect(updateSessionPreference).toHaveBeenLastCalledWith(session.path, {
    pinned: true,
    archived: false,
  })
  expect(await useWorkspaceStore.getState().setSessionArchived(session, true)).toBe(true)
  expect(updateSessionPreference).toHaveBeenLastCalledWith(session.path, {
    pinned: true,
    archived: true,
  })
  expect(await useWorkspaceStore.getState().setSessionArchived(session, false)).toBe(true)
  expect(useWorkspaceStore.getState().sessionPreferences[session.path]).toEqual({
    pinned: true,
    archived: false,
  })
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
  expect(useConversationStore.getState().sessionFile).toBe('current.jsonl')
})

test('archiving the current conversation opens a fresh chat and cannot interrupt its active run', async () => {
  useWorkspaceStore.setState({ ...catalog, projectPath: session.cwd })
  useConversationStore.setState({ sessionFile: session.path, status: 'running' })
  expect(await useWorkspaceStore.getState().setSessionArchived(session, true)).toBe(false)
  expect(updateSessionPreference).not.toHaveBeenCalled()
  useConversationStore.setState({
    status: 'ready',
    connect: vi.fn(async () => {
      useConversationStore.setState({ sessionFile: 'new.jsonl' })
    }),
  })
  expect(await useWorkspaceStore.getState().setSessionArchived(session, true)).toBe(true)
  expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(
    session.cwd,
    undefined,
    { defaultModel: null, defaultPermission: 'ask' },
  )
  expect(useWorkspaceStore.getState().selectedSessionPath).toBe('new.jsonl')
})

test('failed session changes leave the visible catalog and selection intact', async () => {
  useWorkspaceStore.setState({ ...catalog, selectedSessionPath: session.path })
  vi.mocked(updateSessionPreference).mockRejectedValueOnce('无法保存工作台配置')
  expect(await useWorkspaceStore.getState().setSessionArchived(session, true)).toBe(false)
  expect(useWorkspaceStore.getState()).toMatchObject({
    sessionPreferences: {},
    sessionActionPending: null,
    selectedSessionPath: session.path,
    error: '无法保存工作台配置',
  })
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
})

test('an older catalog response cannot undo a completed pin or archive change', async () => {
  useWorkspaceStore.setState({ ...catalog, initialized: true })
  let finish!: (value: WorkspaceCatalog) => void
  vi.mocked(loadCatalog).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const refresh = useWorkspaceStore.getState().refresh()
  await useWorkspaceStore.getState().toggleSessionPinned(session)
  finish(catalog)
  await refresh
  expect(useWorkspaceStore.getState().sessionPreferences[session.path]?.pinned).toBe(true)
  expect(useWorkspaceStore.getState().loading).toBe(false)
})

test('startup restores session preferences without reopening the selected archived conversation', async () => {
  vi.mocked(loadCatalog).mockResolvedValueOnce({
    ...catalog,
    selection: { projectPath: session.cwd, sessionPath: session.path },
    sessionPreferences: { [session.path]: { pinned: true, archived: true } },
  })
  await useWorkspaceStore.getState().initialize()
  expect(useWorkspaceStore.getState().sessionPreferences[session.path]?.archived).toBe(true)
  expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(
    session.cwd,
    undefined,
    { defaultModel: null, defaultPermission: 'ask' },
  )
})

test('project expansion stays independent when opening another project or changing filters', async () => {
  const other = { ...session, path: 'other.jsonl', cwd: 'D:/other' }
  useWorkspaceStore.getState().setProject(session.cwd)
  await useWorkspaceStore.getState().openSession(other)
  expect(useWorkspaceStore.getState().expandedProjects).toMatchObject({
    [sessionKey(session.cwd)!]: true,
    [sessionKey(other.cwd)!]: true,
  })
  useWorkspaceStore.getState().setProjectExpanded(session.cwd, false)
  await useWorkspaceStore.getState().openSession(other)
  expect(useWorkspaceStore.getState().expandedProjects[sessionKey(session.cwd)!]).toBe(false)
})
