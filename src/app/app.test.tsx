import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from './store'
import { isDesktop } from '@/lib/desktop'
import { App } from './app'

vi.mock('@/app/use-theme', () => ({ useTheme() {} }))
vi.mock('@/lib/desktop', () => ({ isDesktop: vi.fn(() => true) }))
vi.mock('@/lib/scrollbars', () => ({ installScrollbars: () => () => {} }))
vi.mock('@/features/workspace/workspace-shell', () => ({
  WorkspaceShell: () => <main aria-label="对话工作区" />,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isDesktop).mockReturnValue(true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.setState({ hydrateSettings: vi.fn().mockResolvedValue(undefined) })
})

test('startup shows the logo and loading status until preferences are ready', () => {
  render(<App />)
  expect(screen.getByRole('img', { name: 'Pi Hearth' })).toBeVisible()
  expect(screen.getByRole('status', { name: '正在打开工作台' })).toBeVisible()
  expect(screen.queryByRole('main')).not.toBeInTheDocument()
  expect(useWorkspaceStore.getState().hydrateSettings).toHaveBeenCalledOnce()
  act(() => useWorkspaceStore.setState({ settingsReady: true }))
  expect(screen.getByRole('main', { name: '对话工作区' })).toBeVisible()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('failed startup retains the logo and offers a retry instead of an endless loader', async () => {
  useWorkspaceStore.setState({ error: '无法读取设置' })
  const user = userEvent.setup()
  render(<App />)
  expect(screen.getByRole('img', { name: 'Pi Hearth' })).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('无法读取设置')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重试' }))
  expect(useWorkspaceStore.getState().hydrateSettings).toHaveBeenCalledTimes(2)
  act(() => useWorkspaceStore.setState({ settingsLoading: true }))
  expect(screen.getByRole('button', { name: '重试' })).toBeDisabled()
})

test('browser previews open the workspace without waiting for desktop preferences', () => {
  vi.mocked(isDesktop).mockReturnValue(false)
  render(<App />)
  expect(screen.getByRole('main', { name: '对话工作区' })).toBeVisible()
  expect(useWorkspaceStore.getState().hydrateSettings).not.toHaveBeenCalled()
})
