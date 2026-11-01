import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'

export function isDesktop() {
  return isTauri()
}

function requireDesktop() {
  if (!isDesktop()) throw new Error('此操作需要在桌面应用中使用。')
}

export async function getAppVersion() {
  requireDesktop()
  return invoke<string>('get_app_version')
}

export async function getPiConfigDirectory() {
  requireDesktop()
  return invoke<string>('pi_config_directory', { open: false })
}

export async function getPiRuntimeVersion() {
  requireDesktop()
  return invoke<string>('pi_runtime_version')
}

export type DirectoryApplication = 'vscode' | 'explorer' | 'terminal'

export async function openDirectoryWith(path: string, application: DirectoryApplication) {
  requireDesktop()
  await invoke<void>('workspace_open_with', { path, application })
}

export async function openPiConfigDirectory() {
  requireDesktop()
  return invoke<string>('pi_config_directory', { open: true })
}

export async function openDeveloperConsole() {
  requireDesktop()
  await invoke<void>('developer_console_open')
}

export async function resetWindowSize() {
  requireDesktop()
  await invoke<void>('window_reset_size')
}

export async function setWindowTheme(theme: 'light' | 'dark' | null, transitionId?: string) {
  if (isDesktop())
    await invoke<void>('set_window_theme', { theme, ...(transitionId ? { transitionId } : {}) })
}

export async function finishWindowThemeChange(transitionId: string) {
  if (isDesktop()) await invoke<void>('finish_window_theme_change', { transitionId })
}

export async function selectProjectDirectory(title = '添加项目') {
  requireDesktop()
  const selected = await open({ directory: true, multiple: false, title })
  return typeof selected === 'string' ? selected : null
}

export async function openProjectFolder(path: string) {
  requireDesktop()
  await invoke<void>('workspace_open_project_folder', { path })
}

export async function controlWindow(action: 'minimize' | 'maximize' | 'close') {
  requireDesktop()
  const window = getCurrentWindow()
  if (action === 'minimize') await window.minimize()
  else if (action === 'maximize') await window.toggleMaximize()
  else await window.close()
}
