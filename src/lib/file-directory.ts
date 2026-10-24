import { invoke } from '@tauri-apps/api/core'

export const resolveFilesDirectory = (
  path: string | null = null,
  projectsDirectory: string | null = null,
) => invoke<string>('workspace_files_directory', { path, projectsDirectory })
