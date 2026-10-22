const key = 'pi-hearth.thinking-level-v2'
const levels = ['default', 'low', 'medium', 'high', 'xhigh', 'max']

export function loadThinkingPreference(): string {
  try {
    const level = localStorage.getItem(key)
    return level && levels.includes(level) ? level : 'default'
  } catch {
    return 'default'
  }
}

export function saveThinkingPreference(level: string) {
  try {
    localStorage.setItem(key, level)
  } catch {
    // The in-memory choice still works when browser storage is unavailable.
  }
}
