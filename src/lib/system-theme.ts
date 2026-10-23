import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isDesktop } from './desktop'

export function usesNativeSystemTheme() {
  return isDesktop() && /Windows/i.test(navigator.userAgent)
}

export async function observeSystemTheme(onChange: (dark: boolean) => void): Promise<() => void> {
  // WebView2's preferred color scheme can override matchMedia after a manual switch.
  if (usesNativeSystemTheme()) {
    let notified = false
    const stop = await listen<boolean>('system-theme-changed', ({ payload }) => {
      notified = true
      onChange(payload)
    })
    try {
      const dark = await invoke<boolean>('get_system_theme')
      if (!notified) onChange(dark)
      return stop
    } catch (reason) {
      stop()
      throw reason
    }
  }

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => onChange(media.matches)
  media.addEventListener('change', apply)
  apply()
  return () => media.removeEventListener('change', apply)
}
