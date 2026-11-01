import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from './store'
import { useConversationStore } from '@/features/conversation/store'
import { changeProjectsDirectory, loadAppSettings, updateAppSettings } from '@/lib/app-settings'
import type { AppSettings } from '@/lib/generated/pi'
import { projectLocationChange } from '@/test/project-location'

vi.mock('@/lib/app-settings', () => ({
  changeProjectsDirectory: vi.fn(),
  loadAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
}))
vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))

const saved: AppSettings = {
  theme: 'dark',
  windowBackground: 'acrylic',
  sidebarOpen: false,
  inspectorOpen: true,
  navigationWidth: 312,
  inspectorWidth: 450,
  expandedProjects: { 'd:/project': false },
  projectOrder: ['d:/project', 'd:/second'],
  sessionOrder: ['history.jsonl', 'older.jsonl'],
  pinnedProjects: ['d:/project'],
  archivedProjects: ['d:/archived'],
  removedProjects: [],
  thinkingLevel: 'xhigh',
  defaultModel: { provider: 'saved', id: 'default-model', name: 'Saved Default' },
  defaultPermission: 'ask',
  projectsDirectory: 'D:/saved-projects',
  customProjectsDirectory: 'D:/saved-projects',
  filesDirectory: 'E:/saved-files',
  customFilesDirectory: 'E:/saved-files',
  developerMode: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  vi.mocked(loadAppSettings).mockResolvedValue(structuredClone(saved))
  vi.mocked(updateAppSettings).mockResolvedValue(structuredClone(saved))
  vi.mocked(changeProjectsDirectory)
    .mockReset()
    .mockImplementation(async (path) => projectLocationChange(path))
})

test('startup restores SQL preferences before the workspace becomes ready', async () => {
  localStorage.setItem('pi-hearth.thinking-level-v2', 'low')
  let resolve!: (settings: AppSettings) => void
  vi.mocked(loadAppSettings).mockReturnValue(new Promise((done) => (resolve = done)))
  const first = useWorkspaceStore.getState().hydrateSettings()
  await useWorkspaceStore.getState().hydrateSettings()
  expect(loadAppSettings).toHaveBeenCalledTimes(1)
  expect(useWorkspaceStore.getState().settingsReady).toBe(false)
  resolve(saved)
  await first
  const { thinkingLevel, removedProjects, ...layout } = saved
  expect(removedProjects).toEqual([])
  expect(useWorkspaceStore.getState()).toMatchObject({
    ...layout,
    settingsReady: true,
    settingsLoading: false,
  })
  expect(useConversationStore.getState().requestedThinkingLevel).toBe(thinkingLevel)
  expect(updateAppSettings).not.toHaveBeenCalled()
})

test('the window background survives restart without changing the theme or active conversation', async () => {
  await useWorkspaceStore.getState().hydrateSettings()
  const conversation = useConversationStore.getState()
  const stored: AppSettings = { ...saved, windowBackground: 'solid' }
  vi.mocked(updateAppSettings).mockResolvedValueOnce(stored)
  await useWorkspaceStore.getState().setWindowBackground('solid')
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({ windowBackground: 'solid' })
  expect(useWorkspaceStore.getState()).toMatchObject({ windowBackground: 'solid', theme: 'dark' })
  expect(useConversationStore.getState()).toBe(conversation)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(loadAppSettings).mockResolvedValueOnce(stored)
  await useWorkspaceStore.getState().hydrateSettings()
  expect(useWorkspaceStore.getState().windowBackground).toBe('solid')
})

test('a rejected background write preserves the saved choice and releases the pending state', async () => {
  await useWorkspaceStore.getState().hydrateSettings()
  vi.mocked(updateAppSettings).mockRejectedValueOnce('disk full')
  await expect(useWorkspaceStore.getState().setWindowBackground('solid')).rejects.toBe('disk full')
  expect(useWorkspaceStore.getState()).toMatchObject({
    windowBackground: 'acrylic',
    windowBackgroundPending: false,
  })
})

test('the legacy thinking choice is imported only when SQL has no preference', async () => {
  localStorage.setItem('pi-hearth.thinking-level-v2', 'medium')
  vi.mocked(loadAppSettings).mockResolvedValue({ ...saved, thinkingLevel: null })
  await useWorkspaceStore.getState().hydrateSettings()
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({ thinkingLevel: 'medium' })
  expect(useConversationStore.getState().requestedThinkingLevel).toBe('medium')
  await useWorkspaceStore.getState().hydrateSettings()
  expect(loadAppSettings).toHaveBeenCalledTimes(1)
})

test('UI changes save only changed fields and never overwrite startup settings', async () => {
  useWorkspaceStore.getState().setTheme('light')
  expect(updateAppSettings).not.toHaveBeenCalled()
  await useWorkspaceStore.getState().hydrateSettings()
  const workspace = useWorkspaceStore.getState()
  workspace.setTheme('light')
  workspace.toggleSidebar()
  workspace.setNavigationWidth(326.4)
  workspace.setProjectExpanded('D:\\project', true)
  await workspace.setProjectsDirectory('D:/new-projects')
  await workspace.setProjectsDirectory('')
  expect(vi.mocked(updateAppSettings).mock.calls.map(([patch]) => patch)).toEqual([
    { theme: 'light' },
    { sidebarOpen: true },
    { navigationWidth: 326 },
    { expandedProjects: { 'd:/project': true } },
  ])
  expect(vi.mocked(changeProjectsDirectory).mock.calls).toEqual([['D:/new-projects'], ['']])
})

test('recent session activity saves its new position and restores it on the next startup', async () => {
  await useWorkspaceStore.getState().hydrateSettings()
  useWorkspaceStore.setState({
    sessions: ['history', 'older'].map((id, index) => ({
      id,
      path: `${id}.jsonl`,
      cwd: 'general',
      title: id,
      modified: 100 - index,
      messageCount: 1,
    })),
  })
  useWorkspaceStore.getState().promoteSession({ sessionId: 'older', sessionFile: 'OLDER.JSONL' })
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({
    sessionOrder: ['older.jsonl', 'history.jsonl'],
  })
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(loadAppSettings).mockResolvedValue({
    ...saved,
    sessionOrder: ['older.jsonl', 'history.jsonl'],
  })
  await useWorkspaceStore.getState().hydrateSettings()
  expect(useWorkspaceStore.getState().sessionOrder).toEqual(['older.jsonl', 'history.jsonl'])
})

test('the saved custom directory survives startup while the default directory is active', async () => {
  vi.mocked(loadAppSettings).mockResolvedValue({ ...saved, projectsDirectory: '' })
  await useWorkspaceStore.getState().hydrateSettings()
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: '',
    customProjectsDirectory: 'D:/saved-projects',
  })
  expect(updateAppSettings).not.toHaveBeenCalled()
  await useWorkspaceStore.getState().setProjectsDirectory('D:/saved-projects')
  expect(changeProjectsDirectory).toHaveBeenCalledExactlyOnceWith('D:/saved-projects')
  expect(updateAppSettings).not.toHaveBeenCalled()
})

test('an existing custom directory is imported before switching back to the default', async () => {
  vi.mocked(loadAppSettings).mockResolvedValue({ ...saved, customProjectsDirectory: '' })
  await useWorkspaceStore.getState().hydrateSettings()
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({
    customProjectsDirectory: 'D:/saved-projects',
  })
  await useWorkspaceStore.getState().setProjectsDirectory('')
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: '',
    customProjectsDirectory: 'D:/saved-projects',
  })
  expect(changeProjectsDirectory).toHaveBeenCalledExactlyOnceWith('')
})

test('file locations remember their custom choice across defaults and startup independently of projects', async () => {
  vi.mocked(loadAppSettings).mockResolvedValue({ ...saved, filesDirectory: '' })
  await useWorkspaceStore.getState().hydrateSettings()
  expect(useWorkspaceStore.getState()).toMatchObject({
    filesDirectory: '',
    customFilesDirectory: 'E:/saved-files',
  })
  useWorkspaceStore.getState().setFilesDirectory('F:/My Files')
  useWorkspaceStore.getState().setFilesDirectory('')
  expect(vi.mocked(updateAppSettings).mock.calls.map(([patch]) => patch)).toEqual([
    { filesDirectory: 'F:/My Files', customFilesDirectory: 'F:/My Files' },
    { filesDirectory: '' },
  ])
  expect(useWorkspaceStore.getState()).toMatchObject({
    filesDirectory: '',
    customFilesDirectory: 'F:/My Files',
    projectsDirectory: saved.projectsDirectory,
  })
})

test('changing either storage location persists only its own directory and custom choice', async () => {
  await useWorkspaceStore.getState().hydrateSettings()
  const workspace = useWorkspaceStore.getState()
  await workspace.setProjectsDirectory('D:/New Projects')
  workspace.setFilesDirectory('E:/New Files')
  await workspace.setProjectsDirectory('')
  workspace.setFilesDirectory('')
  expect(vi.mocked(updateAppSettings).mock.calls.map(([patch]) => patch)).toEqual([
    { filesDirectory: 'E:/New Files', customFilesDirectory: 'E:/New Files' },
    { filesDirectory: '' },
  ])
  expect(vi.mocked(changeProjectsDirectory).mock.calls).toEqual([['D:/New Projects'], ['']])
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: '',
    filesDirectory: '',
    customProjectsDirectory: 'D:/New Projects',
    customFilesDirectory: 'E:/New Files',
  })
})

test('a failed database load keeps startup closed and a retry restores saved settings', async () => {
  vi.mocked(loadAppSettings).mockRejectedValueOnce('database unavailable')
  await useWorkspaceStore.getState().hydrateSettings()
  expect(useWorkspaceStore.getState()).toMatchObject({
    settingsReady: false,
    settingsLoading: false,
    error: 'database unavailable',
  })
  expect(updateAppSettings).not.toHaveBeenCalled()
  await useWorkspaceStore.getState().hydrateSettings()
  expect(useWorkspaceStore.getState()).toMatchObject({ settingsReady: true, error: null })
})

test('preference write failures are visible without undoing the current UI choice', async () => {
  await useWorkspaceStore.getState().hydrateSettings()
  vi.mocked(updateAppSettings).mockRejectedValueOnce('disk full')
  useWorkspaceStore.getState().setTheme('light')
  await vi.waitFor(() => expect(useWorkspaceStore.getState().error).toContain('disk full'))
  expect(useWorkspaceStore.getState().theme).toBe('light')
})

test('the default model persists independently and restores without changing the current conversation', async () => {
  await useWorkspaceStore.getState().hydrateSettings()
  const selected = { provider: 'next', id: 'shared', name: 'New Default' }
  const current = { provider: 'current', id: 'chat', name: 'Current Chat' }
  useConversationStore.setState({ model: current, status: 'running' })
  const conversation = useConversationStore.getState()
  const stored = { ...saved, defaultModel: selected }
  vi.mocked(updateAppSettings).mockResolvedValueOnce(stored)
  await useWorkspaceStore.getState().setDefaultModel(selected)
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({ defaultModel: selected })
  expect(useWorkspaceStore.getState().defaultModel).toEqual(selected)
  expect(useConversationStore.getState()).toBe(conversation)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(loadAppSettings).mockResolvedValueOnce(stored)
  await useWorkspaceStore.getState().hydrateSettings()
  expect(useWorkspaceStore.getState().defaultModel).toEqual(selected)
  expect(useConversationStore.getState().model).toEqual(current)
})

test('a failed default model write keeps the previous saved choice and current model', async () => {
  await useWorkspaceStore.getState().hydrateSettings()
  const current = useConversationStore.getState().model
  vi.mocked(updateAppSettings).mockRejectedValueOnce('disk full')
  await useWorkspaceStore.getState().setDefaultModel({ provider: 'next', id: 'chat', name: 'Next' })
  expect(useWorkspaceStore.getState()).toMatchObject({
    defaultModel: saved.defaultModel,
    defaultModelPending: false,
    error: '无法保存默认模型：disk full',
  })
  expect(useConversationStore.getState().model).toBe(current)
})

test('the permission default survives restart and never mutates an existing session', async () => {
  await useWorkspaceStore.getState().hydrateSettings()
  useConversationStore.setState({ permissionMode: 'auto', status: 'ready' })
  const conversation = useConversationStore.getState()
  const stored: AppSettings = { ...saved, defaultPermission: 'full' }
  vi.mocked(updateAppSettings).mockResolvedValueOnce(stored)
  await useWorkspaceStore.getState().setDefaultPermission('full')
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({ defaultPermission: 'full' })
  expect(useConversationStore.getState()).toBe(conversation)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(loadAppSettings).mockResolvedValueOnce(stored)
  await useWorkspaceStore.getState().hydrateSettings()
  expect(useWorkspaceStore.getState().defaultPermission).toBe('full')
  expect(useConversationStore.getState().permissionMode).toBe('auto')
})

test('a failed permission default write retains the saved mode', async () => {
  await useWorkspaceStore.getState().hydrateSettings()
  vi.mocked(updateAppSettings).mockRejectedValueOnce('disk full')
  await useWorkspaceStore.getState().setDefaultPermission('auto')
  expect(useWorkspaceStore.getState()).toMatchObject({
    defaultPermission: 'ask',
    defaultPermissionPending: false,
    error: '无法保存默认权限：disk full',
  })
})
