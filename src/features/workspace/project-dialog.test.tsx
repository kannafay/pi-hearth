import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { selectProjectDirectory } from '@/lib/desktop'
import { ProjectDialog } from './project-dialog'

vi.mock('@/lib/desktop', () => ({
  isDesktop: () => true,
  selectProjectDirectory: vi.fn().mockResolvedValue(null),
}))

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.setState({ addProject: vi.fn().mockResolvedValue(undefined) })
})

test('project creation creates a named folder and starts a conversation', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<ProjectDialog onClose={onClose} />)
  await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'New Project')
  await user.type(screen.getByRole('textbox', { name: '父文件夹' }), 'D:/projects')
  await user.click(screen.getByRole('button', { name: '开始对话' }))
  expect(useWorkspaceStore.getState().addProject).toHaveBeenCalledExactlyOnceWith(
    'D:/projects',
    'New Project',
  )
  expect(onClose).toHaveBeenCalledOnce()
})

test('an existing project folder uses the same dialog without creating a child folder', async () => {
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:/existing/project')
  render(<ProjectDialog onClose={vi.fn()} />)
  await user.click(screen.getByRole('tab', { name: '选择已有文件夹' }))
  expect(screen.queryByRole('textbox', { name: '项目名称' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始对话' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '选择文件夹' }))
  expect(selectProjectDirectory).toHaveBeenCalledExactlyOnceWith('选择项目文件夹')
  expect(screen.getByRole('textbox', { name: '项目文件夹' })).toHaveValue('D:/existing/project')
  await user.click(screen.getByRole('button', { name: '开始对话' }))
  expect(useWorkspaceStore.getState().addProject).toHaveBeenCalledExactlyOnceWith(
    'D:/existing/project',
    null,
  )
})
