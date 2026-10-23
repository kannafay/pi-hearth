import { invoke } from '@tauri-apps/api/core'
import type {
  ProjectInfo,
  ProjectInstructions,
  SessionSearchResult,
  WorkspaceCatalog,
  SessionPreference,
} from './generated/pi'

export const loadCatalog = () => invoke<WorkspaceCatalog>('workspace_catalog')
export const searchSessions = (query: string) =>
  invoke<SessionSearchResult[]>('workspace_search', { query })
export type CreateProjectOptions = {
  sourcePath: string | null
  name: string | null
  parentPath?: string
  instructions?: string
  expectedInstructions?: string
}
export type UpdateProjectOptions = Omit<CreateProjectOptions, 'sourcePath' | 'parentPath'> & {
  path: string
}
export const addProject = (options: CreateProjectOptions) =>
  invoke<ProjectInfo>('workspace_add_project', options)
export const updateProject = (options: UpdateProjectOptions) =>
  invoke<ProjectInfo>('workspace_update_project', options)
export const removeProject = (path: string) => invoke<void>('workspace_remove_project', { path })
export const updateSessionPreference = (path: string, preference: SessionPreference) =>
  invoke<WorkspaceCatalog['sessionPreferences']>('workspace_update_session', { path, preference })
export const renameSession = (path: string, title: string) =>
  invoke<string>('workspace_rename_session', { path, title })
export const deleteArchivedSessions = (paths: string[]) =>
  invoke<WorkspaceCatalog>('workspace_delete_archived', { paths })
export const readInstructions = (path: string) =>
  invoke<ProjectInstructions>('project_instructions', { path, content: null, expected: null })
export const saveInstructions = (path: string, content: string, expected: string) =>
  invoke<ProjectInstructions>('project_instructions', { path, content, expected })
