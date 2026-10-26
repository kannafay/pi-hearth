import { invoke } from '@tauri-apps/api/core'
import type { ComposerCommand } from './generated/pi'

export const loadComposerCommands = (instanceId: string) =>
  invoke<ComposerCommand[]>('pi_composer_commands', { instanceId })

export const searchProjectFiles = (instanceId: string, query: string) =>
  invoke<string[]>('pi_project_files', { instanceId, query })

export const compactPi = (instanceId: string, runId: string, instructions: string) =>
  invoke<void>('pi_compact', { instanceId, runId, instructions })
