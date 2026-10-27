import { invoke } from '@tauri-apps/api/core'
import type { AppSettings, AppSettingsPatch, ProjectLocationChange } from './generated/pi'

export const loadAppSettings = () => invoke<AppSettings>('app_settings')

let pending = Promise.resolve()

export function updateAppSettings(patch: AppSettingsPatch) {
  return enqueue(() => invoke<AppSettings>('app_update_settings', { patch }))
}

export function changeProjectsDirectory(directory: string) {
  return enqueue(() =>
    invoke<ProjectLocationChange>('workspace_change_projects_directory', { directory }),
  )
}

function enqueue<T>(request: () => Promise<T>) {
  // Preserve the order of rapid UI changes, and allow retries after a failed write.
  const operation = pending.then(request)
  pending = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}
