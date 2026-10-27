import type { SessionInfo, WorkspaceCatalog } from './generated/pi'

export type SessionPreferences = WorkspaceCatalog['sessionPreferences']

export function sessionKey(path: string | null | undefined) {
  return path?.replaceAll('\\', '/').toLowerCase() ?? null
}

export function isCurrentSession(
  session: Pick<SessionInfo, 'id' | 'path'>,
  current: { sessionId: string | null; sessionFile: string | null },
) {
  // Windows can expose one file through both its original and redirected paths.
  // The native ID stays stable; a pending connection may only know its path yet.
  if (session.id && current.sessionId) return session.id === current.sessionId
  return (
    current.sessionFile !== null && sessionKey(session.path) === sessionKey(current.sessionFile)
  )
}

export function compareOrder(order: string[]) {
  const positions = new Map(order.map((path, index) => [sessionKey(path), index]))
  return (a: string, b: string) =>
    (positions.get(sessionKey(a)) ?? -1) - (positions.get(sessionKey(b)) ?? -1)
}

export function sessionPreference(preferences: SessionPreferences, path: string) {
  return preferences[sessionKey(path)!] ?? { pinned: false, archived: false }
}

export function visibleSessions(
  sessions: SessionInfo[],
  preferences: SessionPreferences,
  order: string[] = [],
) {
  const compare = compareOrder(order)
  return sessions
    .filter((session) => !sessionPreference(preferences, session.path).archived)
    .sort(
      (a, b) =>
        Number(sessionPreference(preferences, b.path).pinned) -
          Number(sessionPreference(preferences, a.path).pinned) ||
        compare(a.path, b.path) ||
        b.modified - a.modified,
    )
}

// Materialize the current order before promoting activity so a later catalog
// refresh cannot restore the previous manual position. Other rows keep their order.
export function promoteSessionOrder(
  sessions: SessionInfo[],
  preferences: SessionPreferences,
  order: string[],
  paths: string[],
) {
  if (!paths.length) return order
  const current = visibleSessions(sessions, preferences, order).map((session) =>
    sessionKey(session.path)!,
  )
  const available = new Set(current)
  const promoted = [...new Set(paths.map((path) => sessionKey(path)!))].filter((path) =>
    available.has(path),
  )
  if (!promoted.length) return order
  const active = new Set(promoted)
  const next = [...promoted, ...current.filter((path) => !active.has(path))]
  return next.length === order.length && next.every((path, index) => path === order[index])
    ? order
    : next
}
