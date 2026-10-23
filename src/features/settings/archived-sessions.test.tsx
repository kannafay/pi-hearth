import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { sessionKey } from '@/lib/session-preferences'
import { ArchivedSessions } from './archived-sessions'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))
const sessions = ['已归档的设计讨论', '另一条归档会话', '普通会话'].map((title, index) => ({
  path: `${index}.jsonl`,
  id: String(index),
  cwd: 'project',
  title,
  modified: 3 - index,
  messageCount: 2,
}))

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.setState({
    sessions,
    projects: [{ name: '测试', path: 'project' }],
    sessionPreferences: Object.fromEntries(
      sessions
        .slice(0, 2)
        .map((session) => [sessionKey(session.path), { pinned: false, archived: true }]),
    ),
  })
})

function preview() {
  return render(
    <TooltipProvider>
      <ArchivedSessions />
    </TooltipProvider>,
  )
}

test('mixed selection and select-all restore only archived conversations', async () => {
  const restore = vi.fn(async (session) => {
    useWorkspaceStore.setState((state) => ({
      sessionPreferences: {
        ...state.sessionPreferences,
        [sessionKey(session.path)!]: { pinned: false, archived: false },
      },
    }))
    return true
  })
  useWorkspaceStore.setState({ setSessionArchived: restore })
  const user = userEvent.setup()
  preview()
  expect(screen.queryByText('普通会话')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '恢复所选' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '删除所选' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: `选择 ${sessions[0].title}` }))
  expect(screen.getByRole('button', { name: '恢复所选' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '删除所选' })).toBeEnabled()
  await user.click(screen.getByRole('checkbox', { name: `选择 ${sessions[0].title}` }))
  expect(screen.queryByRole('button', { name: '恢复所选' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '删除所选' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: `选择 ${sessions[0].title}` }))
  expect(screen.getByRole('checkbox', { name: '全选归档会话' })).toHaveAttribute(
    'aria-checked',
    'mixed',
  )
  await user.click(screen.getByRole('checkbox', { name: '全选归档会话' }))
  expect(screen.getByText('已选 2 项')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '恢复所选' }))
  await screen.findByText('暂无归档会话')
  expect(restore).toHaveBeenCalledTimes(2)
  expect(restore).toHaveBeenNthCalledWith(1, sessions[0], false)
  expect(restore).toHaveBeenNthCalledWith(2, sessions[1], false)
  expect(useWorkspaceStore.getState().sessions).toEqual(sessions)
})

test('selected histories are deleted only after confirmation, and cancellation preserves selection', async () => {
  const remove = vi.fn(async (paths: string[]) => {
    useWorkspaceStore.setState((state) => ({
      sessions: state.sessions.filter((session) => !paths.includes(session.path)),
    }))
    return true
  })
  useWorkspaceStore.setState({ deleteArchivedSessions: remove })
  const user = userEvent.setup()
  preview()
  await user.click(screen.getByRole('checkbox', { name: `选择 ${sessions[0].title}` }))
  await user.click(screen.getByRole('button', { name: '删除所选' }))
  const dialog = await screen.findByRole('dialog', { name: '删除 1 个归档会话？' })
  expect(remove).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('checkbox', { name: `选择 ${sessions[0].title}` })).toBeChecked()
  await user.click(screen.getByRole('button', { name: '删除所选' }))
  await user.click(await screen.findByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(remove).toHaveBeenCalledExactlyOnceWith([sessions[0].path])
  expect(screen.queryByText(sessions[0].title)).not.toBeInTheDocument()
  expect(screen.getByText(sessions[1].title)).toBeVisible()
})

test('a failed deletion disables repeat submission and keeps remaining conversations available', async () => {
  let finish!: (result: boolean) => void
  useWorkspaceStore.setState({
    deleteArchivedSessions: vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    ),
  })
  const user = userEvent.setup()
  preview()
  await user.click(screen.getByRole('checkbox', { name: '全选归档会话' }))
  await user.click(screen.getByRole('button', { name: '删除所选' }))
  await user.click(await screen.findByRole('button', { name: '确认删除' }))
  expect(screen.getByRole('button', { name: '正在删除…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
  await act(async () => {
    useWorkspaceStore.setState({ error: '文件正在使用' })
    finish(false)
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('文件正在使用')
  expect(screen.getByRole('button', { name: '删除所选' })).toBeEnabled()
  expect(screen.getByText('已选 2 项')).toBeVisible()
})

test('archived projects restore with their sessions and their delete action first asks for confirmation', async () => {
  useWorkspaceStore.setState({
    archivedProjects: ['project'],
    removeProject: vi.fn().mockResolvedValue(undefined),
  })
  const user = userEvent.setup()
  preview()
  const projects = screen.getByRole('region', { name: '归档项目' })
  expect(within(projects).getByText('测试')).toBeVisible()
  await user.click(within(projects).getByRole('button', { name: '删除项目 测试' }))
  const dialog = await screen.findByRole('dialog', { name: '删除项目“测试”？' })
  expect(useWorkspaceStore.getState().removeProject).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(within(projects).getByRole('button', { name: '恢复项目 测试' }))
  expect(screen.queryByRole('region', { name: '归档项目' })).not.toBeInTheDocument()
  expect(useWorkspaceStore.getState().archivedProjects).toEqual([])
  expect(useWorkspaceStore.getState().sessions).toEqual(sessions)
})
