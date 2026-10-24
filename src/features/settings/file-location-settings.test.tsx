import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { selectProjectDirectory } from '@/lib/desktop'
import { resolveFilesDirectory } from '@/lib/file-directory'
import { StorageLocationSettings } from './storage-location-settings'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true, selectProjectDirectory: vi.fn() }))
vi.mock('@/lib/file-directory', () => ({ resolveFilesDirectory: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(resolveFilesDirectory)
    .mockReset()
    .mockImplementation(
      async (path, projects) =>
        path ?? (projects ? 'D:/Workspace/Files' : 'C:/Documents/Pi Hearth/Files'),
    )
  vi.mocked(selectProjectDirectory).mockReset().mockResolvedValue(null)
})

test('the default follows the projects parent while custom file storage stays independent', async () => {
  const user = userEvent.setup()
  render(<StorageLocationSettings kind="files" />)
  expect(await screen.findByText('C:/Documents/Pi Hearth/Files')).toBeVisible()
  act(() => useWorkspaceStore.getState().setProjectsDirectory('D:/Workspace/Projects'))
  expect(await screen.findByText('D:/Workspace/Files')).toBeVisible()
  expect(resolveFilesDirectory).toHaveBeenLastCalledWith(null, 'D:/Workspace/Projects')
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
  expect(screen.getByText('D:/Workspace/Files')).toBeVisible()
  expect(useWorkspaceStore.getState().customFilesDirectory).toBe('E:/个人文件')
  await user.click(screen.getByRole('combobox', { name: '文件保存位置' }))
  await user.click(await screen.findByRole('option', { name: '自定义目录' }))
  expect(screen.getByRole('button', { name: '更改文件自定义目录' })).toHaveTextContent(
    'E:/个人文件',
  )
  expect(selectProjectDirectory).toHaveBeenCalledOnce()
})

test('cancelled and invalid folder selections preserve the saved file location', async () => {
  const user = userEvent.setup()
  useWorkspaceStore.getState().setFilesDirectory('E:/Existing')
  render(<StorageLocationSettings kind="files" />)
  await screen.findByText('E:/Existing')
  await user.click(screen.getByRole('button', { name: '更改文件自定义目录' }))
  expect(useWorkspaceStore.getState().filesDirectory).toBe('E:/Existing')
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('E:/Missing')
  vi.mocked(resolveFilesDirectory).mockRejectedValueOnce(new Error('文件目录不存在或无法访问。'))
  await user.click(screen.getByRole('button', { name: '更改文件自定义目录' }))
  expect(screen.getByRole('alert')).toHaveTextContent('文件目录不存在')
  expect(useWorkspaceStore.getState()).toMatchObject({
    filesDirectory: 'E:/Existing',
    customFilesDirectory: 'E:/Existing',
  })
})
