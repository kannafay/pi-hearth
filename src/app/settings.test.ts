import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from './store'
import { useConversationStore } from '@/features/conversation/store'
import { loadAppSettings, updateAppSettings } from '@/lib/app-settings'
import type { AppSettings } from '@/lib/generated/pi'

vi.mock('@/lib/app-settings', () => ({ loadAppSettings: vi.fn(), updateAppSettings: vi.fn() }))
vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))

const saved: AppSettings = {
  theme: 'dark',
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
  projectsDirectory: 'D:/saved-projects',
  customProjectsDirectory: 'D:/saved-projects',
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  vi.mocked(loadAppSettings).mockResolvedValue(structuredClone(saved))
  vi.mocked(updateAppSettings).mockResolvedValue(structuredClone(saved))
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
  workspace.setProjectsDirectory('D:/new-projects')
  workspace.setProjectsDirectory('')
  expect(vi.mocked(updateAppSettings).mock.calls.map(([patch]) => patch)).toEqual([
    { theme: 'light' },
    { sidebarOpen: true },
    { navigationWidth: 326 },
    { expandedProjects: { 'd:/project': true } },
    { projectsDirectory: 'D:/new-projects', customProjectsDirectory: 'D:/new-projects' },
    { projectsDirectory: '' },
  ])
})

test('the saved custom directory survives startup while the default directory is active', async () => {
  vi.mocked(loadAppSettings).mockResolvedValue({ ...saved, projectsDirectory: '' })
  await useWorkspaceStore.getState().hydrateSettings()
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: '',
    customProjectsDirectory: 'D:/saved-projects',
  })
  expect(updateAppSettings).not.toHaveBeenCalled()
  useWorkspaceStore.getState().setProjectsDirectory('D:/saved-projects')
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({
    projectsDirectory: 'D:/saved-projects',
  })
})

test('an existing custom directory is imported before switching back to the default', async () => {
  vi.mocked(loadAppSettings).mockResolvedValue({ ...saved, customProjectsDirectory: '' })
  await useWorkspaceStore.getState().hydrateSettings()
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({
    customProjectsDirectory: 'D:/saved-projects',
  })
  useWorkspaceStore.getState().setProjectsDirectory('')
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: '',
    customProjectsDirectory: 'D:/saved-projects',
  })
  expect(updateAppSettings).toHaveBeenLastCalledWith({ projectsDirectory: '' })
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
