import { isDesktop } from '@/lib/desktop'
import { updateAppSettings } from '@/lib/app-settings'

const key = 'pi-hearth.thinking-level-v2'
const levels = ['default', 'off', 'low', 'medium', 'high', 'xhigh', 'max']

export function loadThinkingPreference(): string {
  try {
    const level = localStorage.getItem(key)
    return level && levels.includes(level) ? level : 'default'
  } catch {
    return 'default'
  }
}

export async function saveThinkingPreference(level: string) {
  if (isDesktop()) {
    await updateAppSettings({ thinkingLevel: level })
    return
  }
  try {
    localStorage.setItem(key, level)
  } catch {
    // The in-memory choice still works when browser storage is unavailable.
  }
}
