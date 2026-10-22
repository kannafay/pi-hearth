import { invoke } from '@tauri-apps/api/core'
import type { AppSettings, AppSettingsPatch } from './generated/pi'

export const loadAppSettings = () => invoke<AppSettings>('app_settings')

let pending = Promise.resolve()

export function updateAppSettings(patch: AppSettingsPatch) {
  // Preserve the order of rapid UI changes, and allow retries after a failed write.
  const operation = pending.then(() => invoke<AppSettings>('app_update_settings', { patch }))
  pending = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}
