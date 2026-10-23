import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { selectProjectDirectory } from '@/lib/desktop'
import { resolveProjectDirectory } from '@/lib/project-directory'
import { ProjectLocationSettings } from './project-location-settings'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true, selectProjectDirectory: vi.fn() }))
vi.mock('@/lib/project-directory', () => ({ resolveProjectDirectory: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(resolveProjectDirectory)
    .mockReset()
    .mockImplementation(async (path) => path ?? 'C:/Documents/Pi Hearth/Projects')
  vi.mocked(selectProjectDirectory).mockReset().mockResolvedValue(null)
})

test('switching to the default preserves the custom directory for later reuse', async () => {
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:/Projects')
  render(<ProjectLocationSettings />)
  expect(await screen.findByText('C:/Documents/Pi Hearth/Projects')).toBeVisible()
  expect(screen.queryByRole('button', { name: '选择目录' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('combobox', { name: '新项目保存位置' }))
  await user.click(await screen.findByRole('option', { name: '自定义目录' }))
  expect(selectProjectDirectory).toHaveBeenCalledExactlyOnceWith('新项目保存位置')
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: 'D:/Projects',
    customProjectsDirectory: 'D:/Projects',
  })
  expect(screen.getByText('D:/Projects')).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: '新项目保存位置' }))
  await user.click(await screen.findByRole('option', { name: '默认目录' }))
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: '',
    customProjectsDirectory: 'D:/Projects',
  })
  expect(screen.getByText('C:/Documents/Pi Hearth/Projects')).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: '新项目保存位置' }))
  await user.click(await screen.findByRole('option', { name: '自定义目录' }))
  expect(useWorkspaceStore.getState().projectsDirectory).toBe('D:/Projects')
  expect(screen.getByText('D:/Projects')).toBeVisible()
  expect(selectProjectDirectory).toHaveBeenCalledOnce()
})

test('canceling a custom directory choice keeps the previous preference', async () => {
  const user = userEvent.setup()
  useWorkspaceStore.getState().setProjectsDirectory('D:/Current')
  render(<ProjectLocationSettings />)
  await user.click(screen.getByRole('button', { name: '更改自定义目录' }))
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: 'D:/Current',
    customProjectsDirectory: 'D:/Current',
  })
  expect(screen.getByText('D:/Current')).toBeVisible()
})

test('clicking the custom path replaces the remembered directory', async () => {
  const user = userEvent.setup()
  useWorkspaceStore.getState().setProjectsDirectory('D:/Current')
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('E:/Next')
  render(<ProjectLocationSettings />)
  await user.click(screen.getByRole('button', { name: '更改自定义目录' }))
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: 'E:/Next',
    customProjectsDirectory: 'E:/Next',
  })
  expect(screen.getByText('E:/Next')).toBeVisible()
})

test('canceling the first custom choice leaves the default active and usable', async () => {
  const user = userEvent.setup()
  let resolve!: (path: string | null) => void
  vi.mocked(selectProjectDirectory).mockReturnValueOnce(new Promise((done) => (resolve = done)))
  render(<ProjectLocationSettings />)
  await user.click(screen.getByRole('combobox', { name: '新项目保存位置' }))
  await user.click(await screen.findByRole('option', { name: '自定义目录' }))
  expect(screen.getByRole('combobox', { name: '新项目保存位置' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('正在选择目录')
  await act(async () => resolve(null))
  expect(screen.getByRole('combobox', { name: '新项目保存位置' })).toBeEnabled()
  expect(screen.getByRole('combobox', { name: '新项目保存位置' })).toHaveTextContent('默认目录')
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: '',
    customProjectsDirectory: '',
  })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('invalid directories display an error without replacing the saved location', async () => {
  const user = userEvent.setup()
  useWorkspaceStore.getState().setProjectsDirectory('D:/Current')
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:/Missing')
  render(<ProjectLocationSettings />)
  await screen.findByText('D:/Current')
  vi.mocked(resolveProjectDirectory).mockRejectedValueOnce(new Error('项目目录不存在或无法访问。'))
  await user.click(screen.getByRole('button', { name: '更改自定义目录' }))
  expect(screen.getByRole('alert')).toHaveTextContent('项目目录不存在')
  expect(useWorkspaceStore.getState()).toMatchObject({
    projectsDirectory: 'D:/Current',
    customProjectsDirectory: 'D:/Current',
  })
  expect(screen.getByRole('button', { name: '更改自定义目录' })).toBeEnabled()
})
