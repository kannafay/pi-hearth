import type { SessionInfo, WorkspaceCatalog } from './generated/pi'

export type SessionPreferences = WorkspaceCatalog['sessionPreferences']

export function sessionKey(path: string | null | undefined) {
  return path?.replaceAll('\\', '/').toLowerCase() ?? null
}

export function sessionPreference(preferences: SessionPreferences, path: string) {
  return preferences[sessionKey(path)!] ?? { pinned: false, archived: false }
}

export function visibleSessions(sessions: SessionInfo[], preferences: SessionPreferences) {
  return sessions
    .filter((session) => !sessionPreference(preferences, session.path).archived)
    .sort(
      (a, b) =>
        Number(sessionPreference(preferences, b.path).pinned) -
          Number(sessionPreference(preferences, a.path).pinned) || b.modified - a.modified,
    )
}
