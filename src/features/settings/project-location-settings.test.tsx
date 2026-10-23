import { render, screen } from '@testing-library/react'
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

test('custom project locations can be selected and reset to the Documents default', async () => {
  const user = userEvent.setup()
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:/Projects')
  render(<ProjectLocationSettings />)
  expect(await screen.findByText('C:/Documents/Pi Hearth/Projects')).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: '新项目保存位置' }))
  await user.click(await screen.findByRole('option', { name: '自定义目录' }))
  expect(selectProjectDirectory).toHaveBeenCalledExactlyOnceWith('新项目保存位置')
  expect(useWorkspaceStore.getState().projectsDirectory).toBe('D:/Projects')
  expect(screen.getByText('D:/Projects')).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: '新项目保存位置' }))
  await user.click(await screen.findByRole('option', { name: '默认目录' }))
  expect(useWorkspaceStore.getState().projectsDirectory).toBe('')
  expect(screen.getByText('C:/Documents/Pi Hearth/Projects')).toBeVisible()
})

test('canceling a custom directory choice keeps the previous preference', async () => {
  const user = userEvent.setup()
  useWorkspaceStore.setState({ projectsDirectory: 'D:/Current' })
  render(<ProjectLocationSettings />)
  await user.click(screen.getByRole('button', { name: '选择目录' }))
  expect(useWorkspaceStore.getState().projectsDirectory).toBe('D:/Current')
  expect(screen.getByText('D:/Current')).toBeVisible()
})

test('invalid directories display an error without replacing the saved location', async () => {
  const user = userEvent.setup()
  useWorkspaceStore.setState({ projectsDirectory: 'D:/Current' })
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce('D:/Missing')
  render(<ProjectLocationSettings />)
  await screen.findByText('D:/Current')
  vi.mocked(resolveProjectDirectory).mockRejectedValueOnce(new Error('项目目录不存在或无法访问。'))
  await user.click(screen.getByRole('button', { name: '选择目录' }))
  expect(screen.getByRole('alert')).toHaveTextContent('项目目录不存在')
  expect(useWorkspaceStore.getState().projectsDirectory).toBe('D:/Current')
  expect(screen.getByRole('button', { name: '选择目录' })).toBeEnabled()
})
