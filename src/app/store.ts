import { create } from 'zustand'
import type {
  AppSettingsPatch,
  AppTheme,
  Attachment,
  ProjectInfo,
  SessionInfo,
  WorkspaceCatalog,
} from '@/lib/generated/pi'
import { loadAppSettings, updateAppSettings } from '@/lib/app-settings'
import { isDesktop } from '@/lib/desktop'
import { loadThinkingPreference } from '@/features/conversation/thinking-preference'
import { releaseAttachments } from '@/lib/attachments'
import {
  loadCatalog,
  addProject,
  updateProject,
  removeProject,
  updateSessionPreference,
  renameSession,
  deleteArchivedSessions,
  type CreateProjectOptions,
  type UpdateProjectOptions,
} from '@/lib/workspace'
import { canReuseNewConversation, useConversationStore } from '@/features/conversation/store'
import {
  sessionKey,
  sessionPreference,
  visibleSessions,
  type SessionPreferences,
} from '@/lib/session-preferences'
import {
  moveRelative,
  orderedProjects,
  hasPath,
  sessionGroup,
  type NavigationKind,
  type SortEdge,
} from '@/lib/navigation-order'

export type Theme = AppTheme

interface WorkspaceState {
  projects: ProjectInfo[]
  sessions: SessionInfo[]
  generalCwd: string | null
  selectedSessionPath: string | null
  sessionPreferences: SessionPreferences
  sessionActionPending: string | null
  expandedProjects: Record<string, boolean>
  projectOrder: string[]
  sessionOrder: string[]
  pinnedProjects: string[]
  archivedProjects: string[]
  toggleProjectPinned: (project: ProjectInfo) => void
  setProjectArchived: (project: ProjectInfo, archived: boolean) => Promise<void>
  removeProject: (project: ProjectInfo) => Promise<void>
  reorderNavigation: (
    kind: NavigationKind,
    source: string,
    target: string,
    edge: SortEdge,
  ) => boolean
  setProjectExpanded: (path: string, open: boolean) => void
  toggleSessionPinned: (session: SessionInfo) => Promise<void>
  renameSession: (session: SessionInfo, title: string) => Promise<void>
  setSessionArchived: (session: SessionInfo, archived: boolean) => Promise<boolean>
  deleteArchivedSessions: (paths: string[]) => Promise<boolean>
  initialized: boolean
  loading: boolean
  refreshRequested: boolean
  error: string | null
  projectPath: string | null
  draft: string
  draftAttachments: Attachment[]
  attachmentPreview: Attachment | null
  setAttachmentPreview: (file: Attachment | null) => void
  addAttachments: (files: Attachment[]) => void
  clearAttachments: (ids?: string[]) => void
  sidebarOpen: boolean
  inspectorOpen: boolean
  navigationWidth: number
  inspectorWidth: number
  setNavigationWidth: (width: number) => void
  setInspectorWidth: (width: number) => void
  settingsReady: boolean
  settingsLoading: boolean
  hydrateSettings: () => Promise<void>
  theme: Theme
  projectsDirectory: string
  customProjectsDirectory: string
  developerMode: boolean
  developerModePending: boolean
  setDeveloperMode: (enabled: boolean) => Promise<void>
  setProjectsDirectory: (directory: string) => void
  setProject: (path: string) => void
  setDraft: (draft: string) => void
  toggleSidebar: () => void
  setInspectorOpen: (open: boolean) => void
  setTheme: (theme: Theme) => void
  initialize: () => Promise<void>
  syncActiveSession: () => void
  refresh: () => Promise<void>
  openSession: (session: SessionInfo) => Promise<void>
  newConversation: (
    projectPath: string | null,
    options?: { preserveDraft?: boolean },
  ) => Promise<void>
  addProject: (options: CreateProjectOptions) => Promise<void>
  updateProject: (options: UpdateProjectOptions) => Promise<void>
  reloadCurrent: () => Promise<void>
}

const samePath = (a: string | null | undefined, b: string | null | undefined) =>
  a?.replaceAll('\\', '/').toLowerCase() === b?.replaceAll('\\', '/').toLowerCase()
const busy = () => ['running', 'stopping'].includes(useConversationStore.getState().status)
let navigation = 0
let sessionRevision = 0
function catalogState(catalog: WorkspaceCatalog) {
  return {
    projects: catalog.projects,
    sessions: catalog.sessions,
    generalCwd: catalog.generalCwd,
    sessionPreferences: catalog.sessionPreferences ?? {},
  }
}

function expandProject(expanded: Record<string, boolean>, path: string | null) {
  return path ? { ...expanded, [sessionKey(path)!]: true } : expanded
}

async function finishCatalogLoad() {
  const { refreshRequested } = useWorkspaceStore.getState()
  useWorkspaceStore.setState({ loading: false, refreshRequested: false })
  if (refreshRequested) await useWorkspaceStore.getState().refresh()
}

async function changeSessionPreference(
  session: SessionInfo,
  change: { pinned?: boolean; archived?: boolean },
) {
  const workspace = useWorkspaceStore.getState()
  if (workspace.sessionActionPending) return false
  sessionRevision++
  useWorkspaceStore.setState({ sessionActionPending: session.path, error: null })
  try {
    const preference = {
      ...sessionPreference(workspace.sessionPreferences, session.path),
      ...change,
    }
    const sessionPreferences = await updateSessionPreference(session.path, preference)
    useWorkspaceStore.setState({ sessionPreferences })
    return true
  } catch (reason) {
    useWorkspaceStore.setState({ error: String(reason) })
    return false
  } finally {
    useWorkspaceStore.setState({ sessionActionPending: null })
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  sessions: [],
  generalCwd: null,
  selectedSessionPath: null,
  sessionPreferences: {},
  sessionActionPending: null,
  renameSession: async (session, title) => {
    const name = title.trim()
    if (!name || name.length > 160 || /[\r\n]/.test(name))
      throw new Error('请输入 1–160 个字符的会话标题。')
    if (get().sessionActionPending) throw new Error('请等待当前操作完成。')
    if (busy() && samePath(session.path, useConversationStore.getState().sessionFile))
      throw new Error('请等待当前回复结束后再重命名。')
    sessionRevision++
    set({ sessionActionPending: session.path, error: null })
    try {
      const saved = await renameSession(session.path, name)
      set((state) => ({
        sessions: state.sessions.map((item) =>
          samePath(item.path, session.path) ? { ...item, title: saved } : item,
        ),
      }))
    } finally {
      set({ sessionActionPending: null })
    }
  },
  expandedProjects: {},
  projectOrder: [],
  sessionOrder: [],
  pinnedProjects: [],
  archivedProjects: [],
  toggleProjectPinned: (project) => {
    const key = sessionKey(project.path)!
    set((state) => ({
      pinnedProjects: hasPath(state.pinnedProjects, key)
        ? state.pinnedProjects.filter((path) => sessionKey(path) !== key)
        : [...state.pinnedProjects, key],
    }))
  },
  setProjectArchived: async (project, archived) => {
    if (archived && busy() && samePath(project.path, get().projectPath)) return
    const key = sessionKey(project.path)!
    set((state) => ({
      archivedProjects: archived
        ? [...new Set([...state.archivedProjects, key])]
        : state.archivedProjects.filter((path) => sessionKey(path) !== key),
    }))
    if (archived && samePath(project.path, get().projectPath)) await get().newConversation(null)
  },
  removeProject: async (project) => {
    if (busy() && samePath(project.path, get().projectPath))
      throw new Error('请先停止当前项目的任务。')
    if (get().sessionActionPending) throw new Error('请等待当前操作完成。')
    sessionRevision++
    set({ sessionActionPending: project.path, error: null })
    try {
      await removeProject(project.path)
      const key = sessionKey(project.path)!
      set((state) => ({
        projects: state.projects.filter((item) => !samePath(item.path, project.path)),
        projectOrder: state.projectOrder.filter((path) => sessionKey(path) !== key),
        pinnedProjects: state.pinnedProjects.filter((path) => sessionKey(path) !== key),
        archivedProjects: state.archivedProjects.filter((path) => sessionKey(path) !== key),
        expandedProjects: Object.fromEntries(
          Object.entries(state.expandedProjects).filter(([path]) => path !== key),
        ),
      }))
      if (samePath(project.path, get().projectPath)) await get().newConversation(null)
    } finally {
      set({ sessionActionPending: null })
    }
  },
  reorderNavigation: (kind, source, target, edge) => {
    const state = get()
    if (state.sessionActionPending) return false
    if (kind === 'project') {
      const projects = orderedProjects(
        state.projects,
        state.projectOrder,
        state.pinnedProjects,
      ).filter((project) => !hasPath(state.archivedProjects, project.path))
      if (hasPath(state.pinnedProjects, source) !== hasPath(state.pinnedProjects, target))
        return false
      const projectOrder = moveRelative(
        projects.map((project) => project.path),
        source,
        target,
        edge,
      )
      if (!projectOrder) return false
      set({ projectOrder })
    } else {
      const sessions = visibleSessions(
        state.sessions,
        state.sessionPreferences,
        state.sessionOrder,
      ).filter((session) => !hasPath(state.archivedProjects, session.cwd))
      const from = sessions.find((session) => samePath(session.path, source))
      const to = sessions.find((session) => samePath(session.path, target))
      if (
        !from ||
        !to ||
        sessionGroup(from, state.projects, state.generalCwd) !==
          sessionGroup(to, state.projects, state.generalCwd) ||
        sessionPreference(state.sessionPreferences, source).pinned !==
          sessionPreference(state.sessionPreferences, target).pinned
      )
        return false
      const sessionOrder = moveRelative(
        sessions.map((session) => session.path),
        source,
        target,
        edge,
      )
      if (!sessionOrder) return false
      set({ sessionOrder })
    }
    return true
  },
  setProjectExpanded: (path, open) =>
    set((state) => ({
      expandedProjects: { ...state.expandedProjects, [sessionKey(path)!]: open },
    })),
  toggleSessionPinned: async (session) => {
    const preference = sessionPreference(get().sessionPreferences, session.path)
    await changeSessionPreference(session, { pinned: !preference.pinned })
  },
  setSessionArchived: async (session, archived) => {
    if (archived && busy() && samePath(session.path, useConversationStore.getState().sessionFile))
      return false
    if (!(await changeSessionPreference(session, { archived }))) return false
    if (archived && samePath(session.path, useConversationStore.getState().sessionFile)) {
      await get().newConversation(get().projectPath)
    }
    return true
  },
  deleteArchivedSessions: async (paths) => {
    if (!paths.length || get().sessionActionPending) return false
    sessionRevision++
    set({ sessionActionPending: paths[0], error: null })
    const applyCatalog = (catalog: WorkspaceCatalog) => {
      const remaining = new Set(catalog.sessions.map((session) => sessionKey(session.path)))
      set({
        ...catalogState(catalog),
        selectedSessionPath: remaining.has(sessionKey(get().selectedSessionPath))
          ? get().selectedSessionPath
          : null,
      })
      useConversationStore.setState((state) => {
        const sessionCache = new Map(state.sessionCache)
        for (const path of paths) {
          const key = sessionKey(path)!
          if (!remaining.has(key)) sessionCache.delete(key)
        }
        return { sessionCache }
      })
    }
    try {
      const catalog = await deleteArchivedSessions(paths)
      applyCatalog(catalog)
      return true
    } catch (reason) {
      // A filesystem error may occur after some files have already been removed.
      try {
        applyCatalog(await loadCatalog())
      } catch {
        // Preserve the deletion error so the user can retry after refreshing.
      }
      set({ error: String(reason) })
      return false
    } finally {
      set({ sessionActionPending: null })
    }
  },
  initialized: false,
  loading: false,
  refreshRequested: false,
  error: null,
  projectPath: null,
  draft: '',
  draftAttachments: [],
  attachmentPreview: null,
  setAttachmentPreview: (attachmentPreview) => set({ attachmentPreview }),
  addAttachments: (files) =>
    set((state) => ({ draftAttachments: [...state.draftAttachments, ...files] })),
  clearAttachments: (ids) => {
    const removed = ids ?? get().draftAttachments.map((file) => file.id)
    releaseAttachments(removed)
    set((state) => ({
      draftAttachments: state.draftAttachments.filter((file) => !removed.includes(file.id)),
    }))
  },
  sidebarOpen: true,
  inspectorOpen: false,
  navigationWidth: 300,
  inspectorWidth: 400,
  setNavigationWidth: (width) =>
    set({ navigationWidth: Math.min(400, Math.max(220, Math.round(width))) }),
  setInspectorWidth: (width) =>
    set({ inspectorWidth: Math.min(560, Math.max(300, Math.round(width))) }),
  settingsReady: false,
  settingsLoading: false,
  hydrateSettings: async () => {
    if (get().settingsReady || get().settingsLoading) return
    set({ settingsLoading: true, error: null })
    try {
      const settings = await loadAppSettings()
      const thinkingLevel = settings.thinkingLevel ?? loadThinkingPreference()
      const customProjectsDirectory = settings.customProjectsDirectory || settings.projectsDirectory
      const imported: AppSettingsPatch = {}
      if (settings.thinkingLevel === null) imported.thinkingLevel = thinkingLevel
      if (!settings.customProjectsDirectory && customProjectsDirectory)
        imported.customProjectsDirectory = customProjectsDirectory
      if (Object.keys(imported).length) await updateAppSettings(imported)
      useConversationStore.setState({ requestedThinkingLevel: thinkingLevel })
      set({
        theme: settings.theme,
        sidebarOpen: settings.sidebarOpen,
        inspectorOpen: settings.inspectorOpen,
        navigationWidth: settings.navigationWidth,
        inspectorWidth: settings.inspectorWidth,
        expandedProjects: settings.expandedProjects,
        projectOrder: settings.projectOrder ?? [],
        sessionOrder: settings.sessionOrder ?? [],
        pinnedProjects: settings.pinnedProjects ?? [],
        archivedProjects: settings.archivedProjects ?? [],
        projectsDirectory: settings.projectsDirectory,
        customProjectsDirectory,
        developerMode: settings.developerMode ?? false,
        settingsReady: true,
      })
    } catch (reason) {
      set({ error: String(reason) })
    } finally {
      set({ settingsLoading: false })
    }
  },
  theme: 'system',
  developerMode: false,
  developerModePending: false,
  setDeveloperMode: async (enabled) => {
    if (get().developerModePending) return
    set({ developerModePending: true })
    try {
      const settings = await updateAppSettings({ developerMode: enabled })
      set({ developerMode: settings.developerMode })
    } finally {
      set({ developerModePending: false })
    }
  },
  projectsDirectory: '',
  customProjectsDirectory: '',
  setProjectsDirectory: (projectsDirectory) =>
    set((state) => ({
      projectsDirectory,
      customProjectsDirectory:
        projectsDirectory || state.customProjectsDirectory || state.projectsDirectory,
    })),
  setProject: (projectPath) =>
    set((state) => ({
      projectPath,
      expandedProjects: expandProject(state.expandedProjects, projectPath),
    })),
  setDraft: (draft) => set({ draft }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setTheme: (theme) => set({ theme }),
  initialize: async () => {
    if (get().initialized || get().loading) return
    const request = ++navigation
    set({ loading: true, error: null })
    try {
      const catalog = await loadCatalog()
      if (request !== navigation) {
        set({ ...catalogState(catalog), initialized: true })
        return
      }
      const session = catalog.sessions.find(
        (session) =>
          samePath(session.path, catalog.selection.sessionPath) &&
          !sessionPreference(catalog.sessionPreferences ?? {}, session.path).archived &&
          !hasPath(get().archivedProjects, session.cwd),
      )
      const projectPath = session
        ? samePath(session.cwd, catalog.generalCwd)
          ? null
          : session.cwd
        : (catalog.projects.find(
            (project) =>
              samePath(project.path, catalog.selection.projectPath) &&
              !hasPath(get().archivedProjects, project.path),
          )?.path ?? null)
      const expandedProjects = get().expandedProjects
      const projectKey = sessionKey(projectPath)
      set({
        ...catalogState(catalog),
        projectPath,
        expandedProjects:
          projectKey && expandedProjects[projectKey] === undefined
            ? { ...expandedProjects, [projectKey]: true }
            : expandedProjects,
        selectedSessionPath: session?.path ?? null,
        initialized: true,
      })
      await useConversationStore.getState().connect(projectPath, session?.path)
      if (request === navigation)
        set({ selectedSessionPath: useConversationStore.getState().sessionFile })
    } catch (reason) {
      set({ error: String(reason) })
    } finally {
      await finishCatalogLoad()
    }
  },
  syncActiveSession: () => {
    const conversation = useConversationStore.getState()
    const { instanceId, sessionId, sessionFile, connectionTarget, messages } = conversation
    if (!instanceId || !sessionId || !sessionFile || conversation.status === 'connecting') return
    const firstUserMessage = messages.find((message) => message.role === 'user')
    if (!firstUserMessage) return
    const cwd = connectionTarget
      ? (connectionTarget.projectPath ?? get().generalCwd)
      : (get().projectPath ?? get().generalCwd)
    if (!cwd) return
    const previous = get().sessions.find((session) => samePath(session.path, sessionFile))
    const modified = messages.reduce(
      (latest, message) =>
        Math.max(latest, message.timestamp ?? 0, message.startedAt ?? 0, message.finishedAt ?? 0),
      Math.max(previous?.modified ?? 0, conversation.lastLocalActivityAt ?? 0),
    )
    const session: SessionInfo = {
      path: sessionFile,
      id: sessionId,
      cwd,
      title: previous?.title ?? (firstUserMessage.text.trim() || '未命名会话').slice(0, 160),
      modified: modified || Date.now(),
      messageCount: Math.max(previous?.messageCount ?? 0, messages.length),
    }
    if (
      previous &&
      previous.id === session.id &&
      samePath(previous.cwd, cwd) &&
      previous.modified === session.modified &&
      previous.messageCount === session.messageCount &&
      samePath(get().selectedSessionPath, sessionFile)
    )
      return
    // A catalog requested before this local change must not erase its new row.
    sessionRevision++
    set((state) => ({
      sessions: previous
        ? state.sessions.map((item) => (samePath(item.path, sessionFile) ? session : item))
        : [session, ...state.sessions],
      selectedSessionPath: sessionFile,
    }))
  },
  refresh: async () => {
    if (get().loading) {
      set({ refreshRequested: true })
      return
    }
    if (
      !get().initialized ||
      get().sessionActionPending ||
      useConversationStore.getState().settingsPending
    )
      return
    const request = navigation
    const revision = sessionRevision
    const before = useConversationStore.getState()
    set({ loading: true })
    try {
      const catalog = await loadCatalog()
      if (revision !== sessionRevision) return
      const conversation = useConversationStore.getState()
      if (conversation.settingsPending) return
      const path = conversation.sessionFile
      const previous = get().sessions.find((session) => samePath(session.path, path))
      const next = catalog.sessions.find((session) => samePath(session.path, path))
      const connecting = conversation.status === 'connecting'
      set({
        ...catalogState(catalog),
        // New native sessions may not be written to disk until the first reply ends.
        ...(busy() && previous && !next ? { sessions: [previous, ...catalog.sessions] } : {}),
        ...(connecting ? {} : { selectedSessionPath: path }),
        error: null,
      })
      // Catalog activity uses message timestamps. Local run completion already covers
      // those writes; only later activity needs to be read back from another client.
      const localUpdate =
        conversation.lastLocalActivityAt !== null &&
        next &&
        next.modified <= conversation.lastLocalActivityAt
      if (
        request === navigation &&
        before.instanceId === conversation.instanceId &&
        samePath(before.sessionFile, path) &&
        previous &&
        next &&
        previous.modified !== next.modified &&
        conversation.status === 'ready' &&
        !localUpdate
      ) {
        await conversation.connect(get().projectPath, next.path, { force: true })
      }
    } catch (reason) {
      set({ error: String(reason) })
    } finally {
      await finishCatalogLoad()
    }
  },
  openSession: async (session) => {
    if (busy()) return
    const conversation = useConversationStore.getState()
    if (
      samePath(conversation.sessionFile, session.path) &&
      ['ready', 'connecting'].includes(conversation.status)
    )
      return
    navigation++
    get().clearAttachments()
    const projectPath = samePath(session.cwd, get().generalCwd) ? null : session.cwd
    set({
      projectPath,
      selectedSessionPath: session.path,
      draft: '',
      error: null,
      expandedProjects: expandProject(get().expandedProjects, projectPath),
    })
    await useConversationStore.getState().connect(projectPath, session.path)
  },
  newConversation: async (projectPath, options) => {
    if (busy()) return
    if (canReuseNewConversation(useConversationStore.getState(), projectPath)) return
    const request = ++navigation
    if (!options?.preserveDraft) get().clearAttachments()
    set({
      projectPath,
      selectedSessionPath: null,
      ...(options?.preserveDraft ? {} : { draft: '' }),
      error: null,
      expandedProjects: expandProject(get().expandedProjects, projectPath),
    })
    await useConversationStore.getState().connect(projectPath)
    if (request === navigation)
      set({ selectedSessionPath: useConversationStore.getState().sessionFile })
  },
  addProject: async (options) => {
    const preserveDraft = canReuseNewConversation(
      useConversationStore.getState(),
      get().projectPath,
    )
    const project = await addProject({ ...options, parentPath: get().projectsDirectory })
    const projects = get().projects.some((item) => samePath(item.path, project.path))
      ? get().projects.map((item) => (samePath(item.path, project.path) ? project : item))
      : [...get().projects, project]
    set({
      projects,
      archivedProjects: get().archivedProjects.filter((path) => !samePath(path, project.path)),
    })
    await get().newConversation(project.path, { preserveDraft })
  },
  updateProject: async (options) => {
    if (busy() && samePath(options.path, get().projectPath))
      throw new Error('请先停止当前项目的任务。')
    if (get().sessionActionPending) throw new Error('请等待当前操作完成。')
    sessionRevision++
    set({ sessionActionPending: options.path, error: null })
    try {
      const project = await updateProject(options)
      set((state) => ({
        projects: state.projects.some((item) => samePath(item.path, project.path))
          ? state.projects.map((item) => (samePath(item.path, project.path) ? project : item))
          : [...state.projects, project],
      }))
      if (options.instructions !== undefined && samePath(project.path, get().projectPath))
        await get().reloadCurrent()
    } finally {
      set({ sessionActionPending: null })
    }
  },
  reloadCurrent: async () => {
    if (busy()) return
    const path = useConversationStore.getState().sessionFile
    await useConversationStore
      .getState()
      .connect(
        get().projectPath,
        get().sessions.some((session) => samePath(session.path, path)) ? path : null,
        { force: true },
      )
  },
}))

const persistedKeys = [
  'theme',
  'sidebarOpen',
  'inspectorOpen',
  'navigationWidth',
  'inspectorWidth',
  'expandedProjects',
  'projectOrder',
  'sessionOrder',
  'pinnedProjects',
  'archivedProjects',
  'projectsDirectory',
  'customProjectsDirectory',
] as const

useWorkspaceStore.subscribe((state, previous) => {
  if (!state.settingsReady || !previous.settingsReady || !isDesktop()) return
  const entries = persistedKeys
    .filter((key) => state[key] !== previous[key])
    .map((key) => [key, state[key]])
  if (!entries.length) return
  void updateAppSettings(Object.fromEntries(entries) as AppSettingsPatch).catch(
    (reason: unknown) => {
      useWorkspaceStore.setState({ error: `无法保存应用偏好：${String(reason)}` })
    },
  )
})
