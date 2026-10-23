import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { selectProjectDirectory } from '@/lib/desktop'
import { listenForProjectFolderDrop, resolveProjectDirectory } from '@/lib/project-directory'
import { ProjectDialog } from './project-dialog'

vi.mock('@/lib/desktop', () => ({
  isDesktop: () => true,
  selectProjectDirectory: vi.fn(),
}))
vi.mock('@/lib/project-directory', () => ({
  listenForProjectFolderDrop: vi.fn().mockResolvedValue(() => {}),
  resolveProjectDirectory: vi.fn(),
}))
const defaultDirectory = 'C:/Documents/Pi Hearth/Projects'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(selectProjectDirectory).mockReset().mockResolvedValue(null)
  vi.mocked(resolveProjectDirectory)
    .mockReset()
    .mockImplementation(async (path) => path ?? defaultDirectory)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.setState({ addProject: vi.fn().mockResolvedValue(undefined) })
})
afterEach(() => vi.unstubAllGlobals())

test('a name alone creates a project in the configured location', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<ProjectDialog onClose={onClose} />)
  expect(await screen.findByText(defaultDirectory)).toBeVisible()
  expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: '新建文件夹' })).not.toBeInTheDocument()
  expect(screen.queryByText('此电脑')).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: '项目名称' }), '   ')
  expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'New Project')
  await user.click(screen.getByRole('button', { name: '创建项目' }))
  expect(useWorkspaceStore.getState().addProject).toHaveBeenCalledExactlyOnceWith({
    sourcePath: null,
    name: 'New Project',
  })
  expect(selectProjectDirectory).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledOnce()
})

test('an existing folder can be added without a project name', async () => {
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:\\existing\\project')
  render(<ProjectDialog onClose={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '添加文件夹' }))
  expect(selectProjectDirectory).toHaveBeenCalledExactlyOnceWith('添加源文件夹')
  const name = screen.getByRole('textbox', { name: '项目名称' })
  expect(name).toHaveValue('')
  expect(name).not.toHaveAttribute('readonly')
  expect(name).toHaveAttribute('placeholder', 'project')
  await user.click(screen.getByRole('button', { name: '创建项目' }))
  expect(useWorkspaceStore.getState().addProject).toHaveBeenCalledExactlyOnceWith({
    sourcePath: 'D:\\existing\\project',
    name: null,
  })
})

test('the project name remains independent from the selected folder name', async () => {
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:/existing/folder')
  render(<ProjectDialog onClose={vi.fn()} />)
  await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'Design')
  await user.click(screen.getByRole('button', { name: '添加文件夹' }))
  expect(screen.getByRole('textbox', { name: '项目名称' })).toHaveValue('Design')
  await user.type(screen.getByRole('textbox', { name: '项目名称' }), ' Notes')
  await user.click(screen.getByRole('button', { name: '创建项目' }))
  expect(useWorkspaceStore.getState().addProject).toHaveBeenCalledExactlyOnceWith({
    sourcePath: 'D:/existing/folder',
    name: 'Design Notes',
  })
})

test('canceling a folder change preserves the source and removing it keeps the project name', async () => {
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory)
    .mockResolvedValueOnce('D:/existing/project')
    .mockResolvedValueOnce(null)
  render(<ProjectDialog onClose={vi.fn()} />)
  const name = screen.getByRole('textbox', { name: '项目名称' })
  await user.type(name, 'Draft')
  await user.click(screen.getByRole('button', { name: '添加文件夹' }))
  await user.click(screen.getByRole('button', { name: '更换文件夹' }))
  expect(screen.getByText('D:/existing/project')).toBeVisible()
  expect(name).toHaveValue('Draft')
  await user.click(screen.getByRole('button', { name: '移除文件夹' }))
  expect(name).toHaveValue('Draft')
  expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled()
  await user.clear(name)
  expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled()
  expect(useWorkspaceStore.getState().addProject).not.toHaveBeenCalled()
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
  expect(screen.getByRole('button', { name: '添加文件夹' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(onClose).not.toHaveBeenCalled()
  expect(selectProjectDirectory).toHaveBeenCalledOnce()
  await act(async () => resolve(null))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '添加文件夹' })).toBeEnabled()
})

test('the creation location can be changed without selecting a source folder', async () => {
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:/Projects')
  render(<ProjectDialog onClose={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '更改' }))
  expect(useWorkspaceStore.getState().projectsDirectory).toBe('D:/Projects')
  expect(screen.getByText('D:/Projects')).toBeVisible()
  expect(screen.getByRole('button', { name: '添加文件夹' })).toBeEnabled()
  await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'New')
  await user.keyboard('{Enter}')
  expect(useWorkspaceStore.getState().addProject).toHaveBeenCalledExactlyOnceWith({
    sourcePath: null,
    name: 'New',
  })
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

function observeDropTarget() {
  const target = screen.getByLabelText('源文件夹拖放区')
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 200,
    right: 500,
    bottom: 360,
  } as DOMRect)
  return vi.mocked(listenForProjectFolderDrop).mock.calls.at(-1)![0]
}

test('native folder drops use the drop zone and account for display scaling', async () => {
  vi.stubGlobal('devicePixelRatio', 2)
  render(<ProjectDialog onClose={vi.fn()} />)
  const onDrop = observeDropTarget()
  act(() =>
    onDrop({ type: 'enter', paths: ['D:/source'], position: new PhysicalPosition(400, 500) }),
  )
  expect(screen.getByText('松开以添加文件夹')).toBeVisible()
  await act(async () =>
    onDrop({ type: 'drop', paths: ['D:/source'], position: new PhysicalPosition(400, 500) }),
  )
  expect(await screen.findByText('D:/source')).toBeVisible()
  expect(resolveProjectDirectory).toHaveBeenCalledWith('D:/source')
  expect(selectProjectDirectory).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled()
})

test('drops outside the source area are ignored and files or multiple folders are rejected', async () => {
  render(<ProjectDialog onClose={vi.fn()} />)
  await screen.findByText(defaultDirectory)
  vi.mocked(resolveProjectDirectory).mockClear()
  const onDrop = observeDropTarget()
  act(() => onDrop({ type: 'drop', paths: ['D:/outside'], position: new PhysicalPosition(20, 20) }))
  expect(resolveProjectDirectory).not.toHaveBeenCalled()
  vi.mocked(resolveProjectDirectory).mockRejectedValueOnce(new Error('请添加文件夹，而不是文件。'))
  await act(async () =>
    onDrop({ type: 'drop', paths: ['D:/notes.txt'], position: new PhysicalPosition(200, 250) }),
  )
  expect(screen.getByRole('alert')).toHaveTextContent('请添加文件夹，而不是文件')
  act(() =>
    onDrop({ type: 'drop', paths: ['D:/one', 'D:/two'], position: new PhysicalPosition(200, 250) }),
  )
  expect(screen.getByRole('alert')).toHaveTextContent('请选择一个源文件夹')
  expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled()
  expect(useWorkspaceStore.getState().addProject).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
})
