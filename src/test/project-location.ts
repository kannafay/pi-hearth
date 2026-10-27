import { useWorkspaceStore } from '@/app/store'
import type { ProjectLocationChange } from '@/lib/generated/pi'

export function projectLocationChange(directory: string): ProjectLocationChange {
  const state = useWorkspaceStore.getState()
  return {
    settings: {
      theme: state.theme,
      sidebarOpen: state.sidebarOpen,
      inspectorOpen: state.inspectorOpen,
      navigationWidth: state.navigationWidth,
      inspectorWidth: state.inspectorWidth,
      expandedProjects: state.expandedProjects,
      projectOrder: state.projectOrder,
      sessionOrder: state.sessionOrder,
      pinnedProjects: state.pinnedProjects,
      archivedProjects: state.archivedProjects,
      removedProjects: [],
      thinkingLevel: null,
      defaultModel: state.defaultModel,
      defaultPermission: state.defaultPermission,
      projectsDirectory: directory,
      customProjectsDirectory: directory || state.customProjectsDirectory,
      filesDirectory: state.filesDirectory,
      customFilesDirectory: state.customFilesDirectory,
      developerMode: state.developerMode,
      proxy: state.proxy,
    },
    catalog: {
      projects: state.projects,
      sessions: state.sessions,
      generalCwd: state.generalCwd ?? 'general',
      selection: { projectPath: state.projectPath, sessionPath: state.selectedSessionPath },
      sessionPreferences: state.sessionPreferences,
    },
    paths: [],
    warnings: [],
  }
}
