import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import { removeProject } from './workspace'
import { hasPath, orderedProjects, sessionGroup } from './navigation-order'
import { visibleSessions } from './session-preferences'
import type { SessionInfo } from './generated/pi'

vi.mock('@/lib/workspace', () => ({ removeProject: vi.fn() }))

const projects = ['pinned', 'one', 'two', 'three'].map((name) => ({
  name,
  path: `D:/projects/${name}`,
}))
const history: SessionInfo[] = [
  ['pinned-chat', projects[1].path],
  ['chat-a', projects[1].path],
  ['chat-b', projects[1].path],
  ['other-project', projects[2].path],
  ['general-a', 'general'],
  ['general-b', 'general'],
  ['archived', projects[1].path],
].map(([id, cwd], index) => ({
  id,
  path: `${id}.jsonl`,
  cwd,
  title: id,
  modified: 100 - index,
  messageCount: 2,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(removeProject).mockResolvedValue(undefined)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ status: 'ready' })
  useWorkspaceStore.setState({
    projects,
    sessions: history,
    generalCwd: 'general',
    pinnedProjects: [projects[0].path],
    sessionPreferences: {
      'pinned-chat.jsonl': { pinned: true, archived: false },
      'archived.jsonl': { pinned: false, archived: true },
    },
  })
})

test('manual order remains stable after new replies, while new chats join the top of their partition', () => {
  const order = ['chat-b.jsonl', 'chat-a.jsonl']
  const updated = history.map((session) =>
    session.id === 'chat-a' ? { ...session, modified: 1000 } : session,
  )
  const sorted = visibleSessions(updated, useWorkspaceStore.getState().sessionPreferences, order)
  expect(sorted[0].id).toBe('pinned-chat')
  expect(sorted.map((session) => session.id)).not.toContain('archived')
  expect(sorted.indexOf(sorted.find((session) => session.id === 'chat-b')!)).toBeLessThan(
    sorted.indexOf(sorted.find((session) => session.id === 'chat-a')!),
  )
  const fresh = { ...history[1], id: 'new', path: 'new.jsonl', modified: 2000 }
  expect(
    visibleSessions([...updated, fresh], useWorkspaceStore.getState().sessionPreferences, order)[1]
      .id,
  ).toBe('new')
})

test('projects reorder within their pinned partition and invalid moves leave preferences untouched', () => {
  const store = useWorkspaceStore.getState()
  expect(store.reorderNavigation('project', projects[3].path, projects[1].path, 'before')).toBe(
    true,
  )
  const changed = useWorkspaceStore.getState().projectOrder
  expect(
    orderedProjects(projects, changed, store.pinnedProjects).map((project) => project.name),
  ).toEqual(['pinned', 'three', 'one', 'two'])
  expect(store.reorderNavigation('project', projects[1].path, projects[0].path, 'before')).toBe(
    false,
  )
  expect(store.reorderNavigation('project', projects[0].path, projects[2].path, 'after')).toBe(
    false,
  )
  expect(store.reorderNavigation('project', 'missing', projects[2].path, 'before')).toBe(false)
  expect(useWorkspaceStore.getState().projectOrder).toBe(changed)
})

test('session sorting cannot cross projects, the chat section, pinned rows, or archived rows', () => {
  const move = useWorkspaceStore.getState().reorderNavigation
  expect(move('session', 'chat-b.jsonl', 'chat-a.jsonl', 'before')).toBe(true)
  const changed = useWorkspaceStore.getState().sessionOrder
  for (const [source, target] of [
    ['chat-a.jsonl', 'pinned-chat.jsonl'],
    ['pinned-chat.jsonl', 'chat-a.jsonl'],
    ['chat-a.jsonl', 'other-project.jsonl'],
    ['chat-a.jsonl', 'general-a.jsonl'],
    ['archived.jsonl', 'chat-a.jsonl'],
  ]) {
    expect(move('session', source, target, 'before')).toBe(false)
    expect(useWorkspaceStore.getState().sessionOrder).toBe(changed)
  }
  expect(move('session', 'general-b.jsonl', 'general-a.jsonl', 'before')).toBe(true)
  expect(
    visibleSessions(
      history,
      useWorkspaceStore.getState().sessionPreferences,
      useWorkspaceStore.getState().sessionOrder,
    )
      .filter((session) => sessionGroup(session, projects, 'general') === 'chats')
      .map((session) => session.id),
  ).toEqual(['general-b', 'general-a'])
})

test('project pins normalize Windows paths and manual positions survive unpinning', () => {
  const store = useWorkspaceStore.getState()
  store.reorderNavigation('project', projects[3].path, projects[1].path, 'before')
  const order = useWorkspaceStore.getState().projectOrder
  store.toggleProjectPinned({ ...projects[3], path: 'd:\\PROJECTS\\THREE' })
  expect(hasPath(useWorkspaceStore.getState().pinnedProjects, projects[3].path)).toBe(true)
  expect(
    orderedProjects(projects, order, useWorkspaceStore.getState().pinnedProjects).map(
      (project) => project.name,
    ),
  ).toEqual(['pinned', 'three', 'one', 'two'])
  store.toggleProjectPinned(projects[3])
  expect(useWorkspaceStore.getState().projectOrder).toBe(order)
  expect(hasPath(useWorkspaceStore.getState().pinnedProjects, projects[3].path)).toBe(false)
})

test('archiving the current project leaves its histories intact and switches to a normal conversation', async () => {
  const newConversation = vi.fn().mockResolvedValue(undefined)
  useWorkspaceStore.setState({ projectPath: projects[1].path, newConversation })
  await useWorkspaceStore.getState().setProjectArchived(projects[1], true)
  expect(hasPath(useWorkspaceStore.getState().archivedProjects, projects[1].path)).toBe(true)
  expect(useWorkspaceStore.getState().sessions).toBe(history)
  expect(newConversation).toHaveBeenCalledExactlyOnceWith(null)
  expect(
    useWorkspaceStore
      .getState()
      .reorderNavigation('project', projects[1].path, projects[2].path, 'after'),
  ).toBe(false)
  expect(
    useWorkspaceStore
      .getState()
      .reorderNavigation('session', 'chat-a.jsonl', 'chat-b.jsonl', 'after'),
  ).toBe(false)
  await useWorkspaceStore.getState().setProjectArchived(projects[1], false)
  expect(useWorkspaceStore.getState().archivedProjects).toEqual([])
})

test('project removal cleans only project metadata, retains histories, and preserves state on failure', async () => {
  const newConversation = vi.fn().mockResolvedValue(undefined)
  useWorkspaceStore.setState({
    projectPath: projects[1].path,
    newConversation,
    projectOrder: projects.map((project) => project.path),
    archivedProjects: [projects[1].path],
  })
  vi.mocked(removeProject).mockRejectedValueOnce(new Error('database unavailable'))
  await expect(useWorkspaceStore.getState().removeProject(projects[1])).rejects.toThrow(
    'database unavailable',
  )
  expect(useWorkspaceStore.getState().projects).toBe(projects)
  await useWorkspaceStore.getState().removeProject(projects[1])
  expect(removeProject).toHaveBeenLastCalledWith(projects[1].path)
  expect(useWorkspaceStore.getState().projects).not.toContain(projects[1])
  expect(useWorkspaceStore.getState().archivedProjects).toEqual([])
  expect(useWorkspaceStore.getState().sessions).toBe(history)
  expect(newConversation).toHaveBeenCalledExactlyOnceWith(null)
})
