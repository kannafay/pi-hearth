import { invoke } from '@tauri-apps/api/core'
import type {
  ProjectInfo,
  ProjectInstructions,
  SessionSearchResult,
  WorkspaceCatalog,
} from './generated/pi'

export const loadCatalog = () => invoke<WorkspaceCatalog>('workspace_catalog')
export const searchSessions = (query: string) =>
  invoke<SessionSearchResult[]>('workspace_search', { query })
export const addProject = (path: string, name: string | null = null) =>
  invoke<ProjectInfo>('workspace_add_project', { path, name })
export const readInstructions = (path: string) =>
  invoke<ProjectInstructions>('project_instructions', { path, content: null, expected: null })
export const saveInstructions = (path: string, content: string, expected: string) =>
  invoke<ProjectInstructions>('project_instructions', { path, content, expected })
