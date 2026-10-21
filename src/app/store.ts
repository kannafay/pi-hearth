import { create } from 'zustand'
import type { Attachment, ProjectInfo, SessionInfo, WorkspaceCatalog } from '@/lib/generated/pi'
import { releaseAttachments } from '@/lib/attachments'
import { loadCatalog, addProject } from '@/lib/workspace'
import { useConversationStore } from '@/features/conversation/store'

export type Theme = 'system' | 'light' | 'dark'

interface WorkspaceState {
  projects: ProjectInfo[]
  sessions: SessionInfo[]
  generalCwd: string | null
  selectedSessionPath: string | null
  initialized: boolean
  loading: boolean
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
  theme: Theme
  setProject: (path: string) => void
  setDraft: (draft: string) => void
  toggleSidebar: () => void
  setInspectorOpen: (open: boolean) => void
  setTheme: (theme: Theme) => void
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  openSession: (session: SessionInfo) => Promise<void>
  newConversation: (projectPath: string | null) => Promise<void>
  addProject: (path: string, name?: string | null) => Promise<void>
  reloadCurrent: () => Promise<void>
}

const samePath = (a: string | null | undefined, b: string | null | undefined) =>
  a?.replaceAll('\\', '/').toLowerCase() === b?.replaceAll('\\', '/').toLowerCase()
const busy = () => ['running', 'stopping'].includes(useConversationStore.getState().status)
let navigation = 0
function catalogState(catalog: WorkspaceCatalog) {
  return { projects: catalog.projects, sessions: catalog.sessions, generalCwd: catalog.generalCwd }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  sessions: [],
  generalCwd: null,
  selectedSessionPath: null,
  initialized: false,
  loading: false,
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
  theme: 'system',
  setProject: (projectPath) => set({ projectPath }),
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
      const session = catalog.sessions.find((session) =>
        samePath(session.path, catalog.selection.sessionPath),
      )
      const projectPath = session
        ? samePath(session.cwd, catalog.generalCwd)
          ? null
          : session.cwd
        : (catalog.projects.find((project) => samePath(project.path, catalog.selection.projectPath))
            ?.path ?? null)
      set({
        ...catalogState(catalog),
        projectPath,
        selectedSessionPath: session?.path ?? null,
        initialized: true,
      })
      await useConversationStore.getState().connect(projectPath, session?.path)
      if (request === navigation)
        set({ selectedSessionPath: useConversationStore.getState().sessionFile })
    } catch (reason) {
      set({ error: String(reason) })
    } finally {
      set({ loading: false })
    }
  },
  refresh: async () => {
    if (get().loading || !get().initialized || useConversationStore.getState().settingsPending)
      return
    set({ loading: true })
    try {
      const catalog = await loadCatalog()
      if (useConversationStore.getState().settingsPending) return
      const path = useConversationStore.getState().sessionFile
      const previous = get().sessions.find((session) => samePath(session.path, path))
      const next = catalog.sessions.find((session) => samePath(session.path, path))
      const connecting = useConversationStore.getState().status === 'connecting'
      set({
        ...catalogState(catalog),
        ...(connecting ? {} : { selectedSessionPath: path }),
        error: null,
      })
      if (previous && next && previous.modified !== next.modified && !busy() && !connecting) {
        await useConversationStore.getState().connect(get().projectPath, next.path)
      }
    } catch (reason) {
      set({ error: String(reason) })
    } finally {
      set({ loading: false })
    }
  },
  openSession: async (session) => {
    if (busy()) return
    navigation++
    get().clearAttachments()
    const projectPath = samePath(session.cwd, get().generalCwd) ? null : session.cwd
    set({ projectPath, selectedSessionPath: session.path, draft: '', error: null })
    await useConversationStore.getState().connect(projectPath, session.path)
  },
  newConversation: async (projectPath) => {
    if (busy()) return
    const request = ++navigation
    get().clearAttachments()
    set({ projectPath, selectedSessionPath: null, draft: '', error: null })
    await useConversationStore.getState().connect(projectPath)
    if (request === navigation)
      set({ selectedSessionPath: useConversationStore.getState().sessionFile })
  },
  addProject: async (path, name = null) => {
    const project = await addProject(path, name)
    const projects = get().projects.some((item) => samePath(item.path, project.path))
      ? get().projects
      : [...get().projects, project]
    set({ projects })
    await get().newConversation(project.path)
  },
  reloadCurrent: async () => {
    if (busy()) return
    const path = useConversationStore.getState().sessionFile
    await useConversationStore
      .getState()
      .connect(
        get().projectPath,
        get().sessions.some((session) => samePath(session.path, path)) ? path : null,
      )
  },
}))
