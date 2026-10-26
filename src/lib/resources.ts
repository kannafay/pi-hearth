import { invoke } from '@tauri-apps/api/core'
import type { ResourceCatalog } from './generated/pi'

export const loadResourceCatalog = (projectPath: string | null) =>
  invoke<ResourceCatalog>('pi_resources', { projectPath })
