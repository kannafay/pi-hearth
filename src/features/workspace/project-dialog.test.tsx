import { act, render, screen } from '@testing-library/react'
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
  vi.mocked(selectProjectDirectory).mockReset().mockResolvedValue(null)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.setState({ addProject: vi.fn().mockResolvedValue(undefined) })
})

test('project creation creates a named folder and starts a conversation', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:/projects')
  render(<ProjectDialog onClose={onClose} />)
  expect(screen.getByRole('dialog', { name: '创建项目' })).toBeVisible()
  expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'New Project')
  await user.click(screen.getByRole('button', { name: '新建文件夹' }))
  expect(selectProjectDirectory).toHaveBeenCalledExactlyOnceWith('选择父文件夹')
  expect(screen.getByText('创建位置：D:/projects')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '创建项目' }))
  expect(useWorkspaceStore.getState().addProject).toHaveBeenCalledExactlyOnceWith(
    'D:/projects',
    'New Project',
  )
  expect(onClose).toHaveBeenCalledOnce()
})

test('an existing project folder uses the same dialog without creating a child folder', async () => {
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:\\existing\\project')
  render(<ProjectDialog onClose={vi.fn()} />)
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '添加文件夹' }))
  expect(selectProjectDirectory).toHaveBeenCalledExactlyOnceWith('选择项目文件夹')
  expect(screen.getByRole('textbox', { name: '项目名称' })).toHaveValue('project')
  expect(screen.getByRole('textbox', { name: '项目名称' })).toHaveAttribute('readonly')
  expect(screen.getByText('D:\\existing\\project')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '创建项目' }))
  expect(useWorkspaceStore.getState().addProject).toHaveBeenCalledExactlyOnceWith(
    'D:\\existing\\project',
    null,
  )
})

test('canceling a folder change keeps the selection and removing it restores the draft name', async () => {
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory)
    .mockResolvedValueOnce('D:/existing/project')
    .mockResolvedValueOnce(null)
  render(<ProjectDialog onClose={vi.fn()} />)
  await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'Draft')
  await user.click(screen.getByRole('button', { name: '添加文件夹' }))
  await user.click(screen.getByRole('button', { name: '新建文件夹' }))
  expect(screen.getByText('D:/existing/project')).toBeVisible()
  expect(screen.getByRole('textbox', { name: '项目名称' })).toHaveValue('project')
  expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '移除文件夹' }))
  expect(screen.getByRole('textbox', { name: '项目名称' })).toHaveValue('Draft')
  expect(screen.getByRole('textbox', { name: '项目名称' })).not.toHaveAttribute('readonly')
  expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled()
  expect(useWorkspaceStore.getState().addProject).not.toHaveBeenCalled()
})

test('switching from a new folder to an existing one does not create a child folder', async () => {
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory)
    .mockResolvedValueOnce('D:/parent')
    .mockResolvedValueOnce('D:/existing')
  render(<ProjectDialog onClose={vi.fn()} />)
  await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'Draft')
  await user.click(screen.getByRole('button', { name: '新建文件夹' }))
  await user.click(screen.getByRole('button', { name: '添加已有文件夹' }))
  await user.click(screen.getByRole('button', { name: '创建项目' }))
  expect(useWorkspaceStore.getState().addProject).toHaveBeenCalledExactlyOnceWith(
    'D:/existing',
    null,
  )
})

test('folder selection blocks duplicate pickers and dialog dismissal until it finishes', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  let resolve!: (value: string | null) => void
  vi.mocked(selectProjectDirectory).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  render(<ProjectDialog onClose={onClose} />)
  await user.click(screen.getByRole('button', { name: '添加文件夹' }))
  expect(screen.getByRole('status')).toHaveTextContent('正在选择文件夹')
  expect(screen.getByRole('button', { name: '新建文件夹' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(onClose).not.toHaveBeenCalled()
  expect(selectProjectDirectory).toHaveBeenCalledOnce()
  await act(async () => resolve(null))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '添加文件夹' })).toBeEnabled()
})

test('creation errors keep the selected folder available for retry', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:/existing')
  vi.mocked(useWorkspaceStore.getState().addProject).mockRejectedValueOnce(
    new Error('无法访问目录'),
  )
  render(<ProjectDialog onClose={onClose} />)
  await user.click(screen.getByRole('button', { name: '添加文件夹' }))
  await user.click(screen.getByRole('button', { name: '创建项目' }))
  expect(screen.getByRole('alert')).toHaveTextContent('无法访问目录')
  expect(screen.getByText('D:/existing')).toBeVisible()
  expect(onClose).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '创建项目' }))
  expect(onClose).toHaveBeenCalledOnce()
})
