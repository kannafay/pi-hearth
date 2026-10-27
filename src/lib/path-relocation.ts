import type { PathRelocation } from './generated/pi'
import { sessionKey } from './session-preferences'

export function relocatePath(path: string, changes: PathRelocation[]) {
  const key = sessionKey(path)!
  for (const { from, to } of changes) {
    const prefix = sessionKey(from)!
    if (key === prefix) return to
    if (key.startsWith(`${prefix}/`)) return `${to}/${path.slice(from.length + 1)}`
  }
  return path
}
