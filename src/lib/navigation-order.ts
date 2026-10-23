import type { ProjectInfo, SessionInfo } from './generated/pi'
import { compareOrder, sessionKey } from './session-preferences'

export type NavigationKind = 'project' | 'session'
export type SortEdge = 'before' | 'after'

export function hasPath(paths: string[], path: string) {
  return paths.some((item) => sessionKey(item) === sessionKey(path))
}

export function orderedProjects(projects: ProjectInfo[], order: string[], pinned: string[]) {
  const compare = compareOrder(order)
  return [...projects].sort(
    (a, b) =>
      Number(hasPath(pinned, b.path)) - Number(hasPath(pinned, a.path)) || compare(a.path, b.path),
  )
}

export function sessionGroup(
  session: SessionInfo,
  projects: ProjectInfo[],
  generalCwd: string | null,
) {
  const cwd = sessionKey(session.cwd)
  return cwd !== sessionKey(generalCwd) &&
    projects.some((project) => sessionKey(project.path) === cwd)
    ? `project:${cwd}`
    : 'chats'
}

export function moveRelative(paths: string[], source: string, target: string, edge: SortEdge) {
  const keys = paths.map((path) => sessionKey(path)!)
  const from = sessionKey(source)!
  const to = sessionKey(target)!
  if (from === to || !keys.includes(from) || !keys.includes(to)) return null
  const reordered = keys.filter((key) => key !== from)
  reordered.splice(reordered.indexOf(to) + Number(edge === 'after'), 0, from)
  return reordered.some((key, index) => key !== keys[index]) ? reordered : null
}
