import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from './store'
import { changeProjectsDirectory, updateAppSettings } from '@/lib/app-settings'
import { emptyConversation, useConversationStore } from '@/features/conversation/store'
import { rememberSession } from '@/features/conversation/session-cache'
import { composerDraftKey, loadComposerDraft, saveComposerDraft } from '@/lib/composer-drafts'
import { projectLocationChange } from '@/test/project-location'
import type { ProjectLocationChange } from '@/lib/generated/pi'

vi.mock('@/lib/app-settings', () => ({
  loadAppSettings: vi.fn(),
  updateAppSettings: vi.fn().mockResolvedValue(undefined),
  changeProjectsDirectory: vi.fn(),
}))
vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))

const old = 'D:/Projects/项目'
const next = 'E:/Projects/项目'
const history = `${old}/.pi/history/chat.jsonl`
const movedHistory = `${next}/.pi/history/chat.jsonl`

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ connect: vi.fn().mockResolvedValue(undefined), status: 'ready' })
  useWorkspaceStore.setState({
    settingsReady: true,
    projectsDirectory: 'D:/Projects',
    customProjectsDirectory: 'D:/Projects',
    projects: [{ path: old, name: '项目' }],
    projectPath: old,
    sessions: [
      { path: history, cwd: old, id: 'chat', title: '历史', modified: 1, messageCount: 1 },
    ],
    selectedSessionPath: history,
  })
  vi.mocked(changeProjectsDirectory).mockReset()
})

function result() {
  const change = projectLocationChange('E:/Projects')
  change.paths = [{ from: old, to: next }]
  change.settings.pinnedProjects = [next]
  change.settings.projectOrder = [next]
  change.settings.expandedProjects = { 'e:/projects/项目': false }
  change.settings.sessionOrder = [movedHistory]
  change.catalog.projects = [{ path: next, name: '项目' }]
  change.catalog.sessions = [{ ...change.catalog.sessions[0], path: movedHistory, cwd: next }]
  change.catalog.selection = { projectPath: next, sessionPath: movedHistory }
  change.catalog.sessionPreferences = {
    'e:/projects/项目/.pi/history/chat.jsonl': { pinned: true, archived: false },
  }
  return change
}

test('a committed migration updates navigation, the current session, cached paths and unsent drafts together', async () => {
  useWorkspaceStore.setState({
    draftKey: composerDraftKey(old),
    draft: '正在编辑',
    draftId: 'current-draft',
  })
  const otherDraft = { id: 'nested-draft', text: '子项目草稿', attachments: [] }
  saveComposerDraft(composerDraftKey(`${old}/nested`), otherDraft)
  useConversationStore.setState({
    sessionId: 'chat',
    sessionFile: history,
    instanceId: 'old-instance',
    connectionTarget: { projectPath: old, sessionPath: history },
    sessionCache: rememberSession(new Map(), {
      ...emptyConversation,
      status: 'ready',
      sessionFile: history,
      sessionId: 'chat',
      instanceId: 'cached-instance',
    }),
  })
  vi.mocked(updateAppSettings).mockClear()
  vi.mocked(changeProjectsDirectory).mockResolvedValue(result())
  await expect(useWorkspaceStore.getState().setProjectsDirectory('E:/Projects')).resolves.toEqual(
    [],
  )
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectPath: next,
    selectedSessionPath: movedHistory,
    projectsDirectory: 'E:/Projects',
    customProjectsDirectory: 'E:/Projects',
    pinnedProjects: [next],
    projectOrder: [next],
    sessionOrder: [movedHistory],
    expandedProjects: { 'e:/projects/项目': false },
    projectsDirectoryPending: false,
    draftKey: composerDraftKey(next),
    draft: '正在编辑',
  })
  expect(useConversationStore.getState().sessionFile).toBe(movedHistory)
  expect(useConversationStore.getState().sessionCache.get('id:chat')?.paths).toEqual([
    movedHistory.toLowerCase(),
  ])
  expect(useConversationStore.getState().connect).toHaveBeenCalledWith(
    next,
    movedHistory,
    expect.objectContaining({ force: true, sessionId: 'chat' }),
  )
  expect(loadComposerDraft(composerDraftKey(next)).text).toBe('正在编辑')
  expect(loadComposerDraft(composerDraftKey(`${next}/nested`))).toEqual(otherDraft)
  expect(
    localStorage.getItem(`pi-hearth.composer-draft.v1:${composerDraftKey(`${old}/nested`)}`),
  ).toBeNull()
  expect(updateAppSettings).not.toHaveBeenCalled()
})

test('migration keeps the old location visible and prevents navigation and duplicate changes until completion', async () => {
  let resolve!: (change: ProjectLocationChange) => void
  vi.mocked(changeProjectsDirectory).mockReturnValueOnce(new Promise((done) => (resolve = done)))
  const migration = useWorkspaceStore.getState().setProjectsDirectory('E:/Projects')
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: 'D:/Projects',
    projectsDirectoryPending: true,
  })
  await expect(useWorkspaceStore.getState().setProjectsDirectory('F:/Projects')).rejects.toThrow(
    '请等待当前操作完成',
  )
  useWorkspaceStore.getState().setProject('outside')
  await useWorkspaceStore
    .getState()
    .openSession({ ...useWorkspaceStore.getState().sessions[0], cwd: 'outside' })
  await useWorkspaceStore.getState().newConversation('outside')
  expect(useWorkspaceStore.getState().projectPath).toBe(old)
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
  resolve(result())
  await migration
  expect(changeProjectsDirectory).toHaveBeenCalledTimes(1)
  expect(useWorkspaceStore.getState().projectsDirectoryPending).toBe(false)
})

test('a failed migration retains the original settings, paths and draft and releases the operation lock', async () => {
  useWorkspaceStore.setState({ draftKey: composerDraftKey(old), draft: '保留草稿' })
  const before = useWorkspaceStore.getState()
  vi.mocked(changeProjectsDirectory).mockRejectedValueOnce(new Error('目标目录已存在'))
  await expect(before.setProjectsDirectory('E:/Projects')).rejects.toThrow('目标目录已存在')
  expect(useWorkspaceStore.getState()).toMatchObject({
    projects: before.projects,
    sessions: before.sessions,
    projectPath: old,
    projectsDirectory: 'D:/Projects',
    customProjectsDirectory: 'D:/Projects',
    draft: '保留草稿',
    draftKey: composerDraftKey(old),
    projectsDirectoryPending: false,
    sessionActionPending: null,
  })
})

test.each(['foreground', 'background'] as const)(
  'a %s reply prevents migration before any directory changes',
  async (where) => {
    useConversationStore.setState(
      where === 'foreground'
        ? { status: 'running' }
        : {
            backgroundSessions: new Map([
              [
                'background',
                { data: { ...emptyConversation, status: 'running' }, projectPath: old },
              ],
            ]),
          },
    )
    await expect(useWorkspaceStore.getState().setProjectsDirectory('E:/Projects')).rejects.toThrow(
      '请等待所有会话',
    )
    expect(changeProjectsDirectory).not.toHaveBeenCalled()
  },
)
