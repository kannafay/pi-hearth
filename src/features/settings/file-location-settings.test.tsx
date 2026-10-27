import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { selectProjectDirectory } from '@/lib/desktop'
import { resolveFilesDirectory } from '@/lib/file-directory'
import { StorageLocationSettings } from './storage-location-settings'
import { changeProjectsDirectory } from '@/lib/app-settings'
import { projectLocationChange } from '@/test/project-location'

vi.mock('@/lib/app-settings', async (original) => ({
  ...(await original<typeof import('@/lib/app-settings')>()),
  changeProjectsDirectory: vi.fn(),
}))

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true, selectProjectDirectory: vi.fn() }))
vi.mock('@/lib/file-directory', () => ({ resolveFilesDirectory: vi.fn() }))
vi.mock('@/lib/project-directory', () => ({
  resolveProjectDirectory: vi.fn(async (path) => path ?? 'C:/Documents/Pi Hearth/Projects'),
}))

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(resolveFilesDirectory)
    .mockReset()
    .mockImplementation(async (path) => path ?? 'C:/Documents/Pi Hearth/Files')
  vi.mocked(selectProjectDirectory).mockReset().mockResolvedValue(null)
  vi.mocked(changeProjectsDirectory)
    .mockReset()
    .mockImplementation(async (path) => projectLocationChange(path))
})

test('the file default stays fixed and its custom directory is remembered independently', async () => {
  const user = userEvent.setup()
  render(<StorageLocationSettings kind="files" />)
  expect(await screen.findByText('C:/Documents/Pi Hearth/Files')).toBeVisible()
  act(() =>
    useWorkspaceStore.setState({
      projectsDirectory: 'D:/Workspace/Projects',
      customProjectsDirectory: 'D:/Workspace/Projects',
    }),
  )
  expect(screen.getByText('C:/Documents/Pi Hearth/Files')).toBeVisible()
  expect(resolveFilesDirectory).toHaveBeenCalledExactlyOnceWith()
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('E:/个人文件')
  await user.click(screen.getByRole('combobox', { name: '文件保存位置' }))
  await user.click(await screen.findByRole('option', { name: '自定义目录' }))
  expect(selectProjectDirectory).toHaveBeenCalledExactlyOnceWith('文件保存位置')
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: 'D:/Workspace/Projects',
    filesDirectory: 'E:/个人文件',
    customFilesDirectory: 'E:/个人文件',
  })
  await user.click(screen.getByRole('combobox', { name: '文件保存位置' }))
  await user.click(await screen.findByRole('option', { name: '默认目录' }))
  expect(screen.getByText('C:/Documents/Pi Hearth/Files')).toBeVisible()
  expect(useWorkspaceStore.getState().customFilesDirectory).toBe('E:/个人文件')
  await user.click(screen.getByRole('combobox', { name: '文件保存位置' }))
  await user.click(await screen.findByRole('option', { name: '自定义目录' }))
  expect(screen.getByText('E:/个人文件')).toBeVisible()
  expect(screen.getByText('E:/个人文件').closest('button, a')).toBeNull()
  expect(screen.getByRole('button', { name: '更改文件目录' })).toHaveTextContent('更改目录')
  expect(selectProjectDirectory).toHaveBeenCalledOnce()
})

test.each(['projects', 'files'] as const)(
  'changing %s keeps both storage controls and remembered directories independent',
  async (first) => {
    const user = userEvent.setup()
    render(
      <>
        <StorageLocationSettings kind="projects" />
        <StorageLocationSettings kind="files" />
      </>,
    )
    await screen.findByText('C:/Documents/Pi Hearth/Projects')
    await screen.findByText('C:/Documents/Pi Hearth/Files')
    const titles = { projects: '项目保存位置', files: '文件保存位置' }
    const paths = { projects: 'D:/Projects', files: 'E:/Files' }
    const other = first === 'projects' ? 'files' : 'projects'
    const choose = async (kind: 'projects' | 'files', mode: '默认目录' | '自定义目录') => {
      await user.click(screen.getByRole('combobox', { name: titles[kind] }))
      await user.click(await screen.findByRole('option', { name: mode }))
    }
    vi.mocked(selectProjectDirectory).mockResolvedValueOnce(paths[first])
    await choose(first, '自定义目录')
    expect(screen.getByRole('combobox', { name: titles[first] })).toHaveTextContent('自定义目录')
    expect(screen.getByRole('combobox', { name: titles[other] })).toHaveTextContent('默认目录')
    expect(useWorkspaceStore.getState()).toMatchObject({
      projectsDirectory: first === 'projects' ? paths.projects : '',
      filesDirectory: first === 'files' ? paths.files : '',
    })
    expect(
      screen.getByText(`C:/Documents/Pi Hearth/${other === 'files' ? 'Files' : 'Projects'}`),
    ).toBeVisible()

    vi.mocked(selectProjectDirectory).mockResolvedValueOnce(paths[other])
    await choose(other, '自定义目录')
    await choose(first, '默认目录')
    expect(screen.getByRole('combobox', { name: titles[other] })).toHaveTextContent('自定义目录')
    expect(screen.getByText(paths[other])).toBeVisible()
    expect(useWorkspaceStore.getState()).toMatchObject({
      customProjectsDirectory: paths.projects,
      customFilesDirectory: paths.files,
    })
    await choose(first, '自定义目录')
    expect(useWorkspaceStore.getState()).toMatchObject({
      projectsDirectory: paths.projects,
      filesDirectory: paths.files,
    })
    expect(selectProjectDirectory).toHaveBeenCalledTimes(2)
    expect(selectProjectDirectory).toHaveBeenNthCalledWith(1, titles[first])
    expect(selectProjectDirectory).toHaveBeenNthCalledWith(2, titles[other])
  },
)

test('cancelled and invalid folder selections preserve the saved file location', async () => {
  const user = userEvent.setup()
  useWorkspaceStore.getState().setFilesDirectory('E:/Existing')
  render(<StorageLocationSettings kind="files" />)
  await screen.findByText('E:/Existing')
  await user.click(screen.getByRole('button', { name: '更改文件目录' }))
  expect(useWorkspaceStore.getState().filesDirectory).toBe('E:/Existing')
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('E:/Missing')
  vi.mocked(resolveFilesDirectory).mockRejectedValueOnce(new Error('文件目录不存在或无法访问。'))
  await user.click(screen.getByRole('button', { name: '更改文件目录' }))
  expect(screen.getByRole('alert')).toHaveTextContent('文件目录不存在')
  expect(useWorkspaceStore.getState()).toMatchObject({
    filesDirectory: 'E:/Existing',
    customFilesDirectory: 'E:/Existing',
  })
})
