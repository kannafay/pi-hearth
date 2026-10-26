import { invoke } from '@tauri-apps/api/core'
import type { ModelInfo, ResourceCatalog, ResourceInfo } from './generated/pi'

export type ResourceKind = 'skills' | 'mcp'

export const loadResourceCatalog = (projectPath: string | null) =>
  invoke<ResourceCatalog>('pi_resources', { projectPath })

export const setResourceEnabled = (
  kind: ResourceKind,
  item: ResourceInfo,
  projectPath: string | null,
  enabled: boolean,
) =>
  invoke<ResourceCatalog>('pi_resource_toggle', {
    kind,
    name: item.name,
    source: item.source,
    projectPath,
    enabled,
  })

export const openResource = (kind: ResourceKind, item: ResourceInfo, projectPath: string | null) =>
  invoke<void>('pi_resource_open', { kind, name: item.name, source: item.source, projectPath })

export const loadModelCatalog = () => invoke<ModelInfo[]>('pi_models')
