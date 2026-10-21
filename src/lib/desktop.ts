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

export async function setWindowTheme(theme: 'light' | 'dark' | null) {
  if (isDesktop()) await getCurrentWindow().setTheme(theme)
}

export async function listenForWindowFocus(onChange: (focused: boolean) => void) {
  if (!isDesktop()) {
    const focus = () => onChange(true)
    const blur = () => onChange(false)
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    onChange(document.hasFocus())
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
    }
  }

  const nativeWindow = getCurrentWindow()
  let changed = false
  const unlisten = await nativeWindow.onFocusChanged(({ payload }) => {
    changed = true
    onChange(payload)
  })
  try {
    const focused = await nativeWindow.isFocused()
    if (!changed) onChange(focused)
  } catch (reason) {
    unlisten()
    throw reason
  }
  return unlisten
}

export async function selectProjectDirectory(title = '添加项目') {
  requireDesktop()
  const selected = await open({ directory: true, multiple: false, title })
  return typeof selected === 'string' ? selected : null
}

export async function controlWindow(action: 'minimize' | 'maximize' | 'close') {
  requireDesktop()
  const window = getCurrentWindow()
  if (action === 'minimize') await window.minimize()
  else if (action === 'maximize') await window.toggleMaximize()
  else await window.close()
}
