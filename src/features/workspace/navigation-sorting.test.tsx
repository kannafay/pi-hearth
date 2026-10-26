import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import { WorkspaceNavigation } from './workspace-navigation'

const projects = ['Pinned', 'Alpha', 'Beta'].map((name) => ({
  name,
  path: `D:/projects/${name.toLowerCase()}`,
}))
const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
const hitTest = vi.fn()
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ status: 'ready' })
  useWorkspaceStore.setState({ projects, pinnedProjects: [projects[0].path] })
  hitTest.mockReset()
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hitTest })
})
afterEach(() => {
  vi.unstubAllGlobals()
  if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest)
  else Reflect.deleteProperty(document, 'elementFromPoint')
})
function view() {
  return render(
    <WorkspaceNavigation
      desktop
      onCreate={vi.fn()}
      onSettings={vi.fn()}
      onInstructions={vi.fn()}
    />,
  )
}
function projectNames() {
  return [
    ...screen.getByRole('region', { name: '项目' }).querySelectorAll('[data-sort-kind="project"]'),
  ].map((item) => item.querySelector('[data-sort-handle]')?.textContent)
}
function drag(sourceName: string, targetName: string) {
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId = 1
      pointerType = 'mouse'
    },
  )
  const source = screen.getByRole('button', { name: sourceName })
  const target = screen.getByRole('button', { name: targetName })
  vi.spyOn(target.closest('[data-sort-kind]')!, 'getBoundingClientRect').mockReturnValue({
    top: 40,
    height: 30,
  } as DOMRect)
  hitTest.mockReturnValue(target)
  fireEvent.pointerDown(source, { button: 0, clientX: 20, clientY: 100 })
  fireEvent.pointerMove(document, { clientX: 22, clientY: 45 })
  return { source, target }
}

test('pointer sorting moves the row, suppresses its click, and cleans the drop indicator', () => {
  view()
  const { source, target } = drag('Beta', 'Alpha')
  expect(target.closest('[data-sort-kind]')).toHaveAttribute('data-sort-edge', 'before')
  fireEvent.pointerUp(document, { clientX: 22, clientY: 45 })
  expect(projectNames()).toEqual(['Pinned', 'Beta', 'Alpha'])
  fireEvent.click(source)
  expect(source).toHaveAttribute('aria-expanded', 'false')
  expect(document.querySelector('[data-sort-edge]')).toBeNull()
  expect(document.querySelector('.sidebar-sort-preview')).toBeNull()
})

test('dragging across the pinned boundary or pressing Escape never changes the order', () => {
  view()
  drag('Beta', 'Pinned')
  expect(document.querySelector('[data-sort-edge]')).toBeNull()
  fireEvent.pointerUp(document, { clientX: 22, clientY: 45 })
  expect(projectNames()).toEqual(['Pinned', 'Alpha', 'Beta'])
  drag('Beta', 'Alpha')
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.pointerUp(document, { clientX: 22, clientY: 45 })
  expect(projectNames()).toEqual(['Pinned', 'Alpha', 'Beta'])
  expect(document.querySelector('[data-navigation-sorting]')).toBeNull()
})

test('keyboard sorting respects the same boundary and keeps the project collapsed', async () => {
  const user = userEvent.setup()
  view()
  const alpha = screen.getByRole('button', { name: 'Alpha' })
  act(() => alpha.focus())
  await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
  expect(projectNames()).toEqual(['Pinned', 'Alpha', 'Beta'])
  await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
  expect(projectNames()).toEqual(['Pinned', 'Beta', 'Alpha'])
  expect(alpha).toHaveFocus()
  expect(alpha).toHaveAttribute('aria-expanded', 'false')
})

test('dragging conversations reorders only their own project and never opens a conversation', () => {
  const openSession = vi.fn()
  useWorkspaceStore.setState({
    expandedProjects: {
      [projects[1].path.toLowerCase()]: true,
      [projects[2].path.toLowerCase()]: true,
    },
    openSession,
    sessions: [
      ['Pinned chat', projects[1].path],
      ['Chat A', projects[1].path],
      ['Chat B', projects[1].path],
      ['Other chat', projects[2].path],
    ].map(([title, cwd], index) => ({
      path: `${index}.jsonl`,
      id: String(index),
      title,
      cwd,
      modified: 10 - index,
      messageCount: 2,
    })),
    sessionPreferences: { '0.jsonl': { pinned: true, archived: false } },
  })
  view()
  const first = drag('Chat B', 'Chat A')
  fireEvent.pointerUp(document, { clientX: 22, clientY: 45 })
  fireEvent.click(first.source)
  expect(openSession).not.toHaveBeenCalled()
  const changed = useWorkspaceStore.getState().sessionOrder
  expect(changed.indexOf('2.jsonl')).toBeLessThan(changed.indexOf('1.jsonl'))
  drag('Chat A', 'Pinned chat')
  fireEvent.pointerUp(document, { clientX: 22, clientY: 45 })
  expect(useWorkspaceStore.getState().sessionOrder).toBe(changed)
  drag('Chat A', 'Other chat')
  fireEvent.pointerUp(document, { clientX: 22, clientY: 45 })
  expect(useWorkspaceStore.getState().sessionOrder).toBe(changed)
})

test('project rows pin projects directly, and menus archive projects or confirm removal', async () => {
  const user = userEvent.setup()
  const removeProject = vi.fn().mockResolvedValue(undefined)
  useWorkspaceStore.setState({ removeProject })
  view()
  await user.click(screen.getByRole('button', { name: '置顶 Beta' }))
  expect(projectNames()).toEqual(['Pinned', 'Beta', 'Alpha'])
  await user.click(screen.getByRole('button', { name: 'Beta 项目菜单' }))
  const menu = await screen.findByRole('menu')
  expect(within(menu).queryByRole('menuitem', { name: '新对话' })).not.toBeInTheDocument()
  expect(within(menu).queryByRole('menuitem', { name: '置顶项目' })).not.toBeInTheDocument()
  await user.click(await screen.findByRole('menuitem', { name: '归档项目' }))
  expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'Alpha 项目菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '删除项目' }))
  let dialog = await screen.findByRole('dialog', { name: '删除项目“Alpha”？' })
  expect(within(dialog).getByText(/源文件夹和本地聊天记录会保留/)).toBeVisible()
  expect(removeProject).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(removeProject).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Alpha 项目菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '删除项目' }))
  dialog = await screen.findByRole('dialog', { name: '删除项目“Alpha”？' })
  await user.click(within(dialog).getByRole('button', { name: '确认删除项目' }))
  expect(removeProject).toHaveBeenCalledExactlyOnceWith(projects[1])
})
