const key = 'pi-hearth.thinking-level'
const levels = ['low', 'medium', 'high', 'max']

export function loadThinkingPreference(): string | null {
  try {
    const level = localStorage.getItem(key)
    return level && levels.includes(level) ? level : null
  } catch {
    return null
  }
}

export function saveThinkingPreference(level: string) {
  try {
    localStorage.setItem(key, level)
  } catch {
    // The in-memory choice still works when browser storage is unavailable.
  }
}
