import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { updateAppSettings } from '@/lib/app-settings'
import { isDesktop, openDeveloperConsole } from '@/lib/desktop'
import type { AppSettings } from '@/lib/generated/pi'
import { DeveloperModeSettings } from './developer-mode-settings'

vi.mock('@/lib/app-settings', () => ({ loadAppSettings: vi.fn(), updateAppSettings: vi.fn() }))
vi.mock('@/lib/desktop', () => ({ isDesktop: vi.fn(), openDeveloperConsole: vi.fn() }))

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.clearAllMocks()
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Windows NT 10.0')
  vi.mocked(updateAppSettings).mockImplementation(
    async (patch) => ({ developerMode: patch.developerMode }) as AppSettings,
  )
  vi.mocked(openDeveloperConsole).mockResolvedValue(undefined)
})

test('developer mode saves once per toggle and allows reopening its independent terminal', async () => {
  useWorkspaceStore.setState({ settingsReady: true })
  const user = userEvent.setup()
  render(<DeveloperModeSettings />)
  const control = screen.getByRole('switch', { name: '开发者模式' })
  expect(control).not.toBeChecked()
  await user.click(control)
  expect(control).toBeChecked()
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({ developerMode: true })
  await user.click(screen.getByRole('button', { name: '打开终端' }))
  expect(openDeveloperConsole).toHaveBeenCalledExactlyOnceWith()
  expect(updateAppSettings).toHaveBeenCalledTimes(1)
  await user.click(control)
  expect(control).not.toBeChecked()
  expect(updateAppSettings).toHaveBeenLastCalledWith({ developerMode: false })
  expect(updateAppSettings).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: '打开终端' })).not.toBeInTheDocument()
})

test('a failed terminal or database operation retains the previous mode and allows retry', async () => {
  vi.mocked(updateAppSettings).mockRejectedValueOnce('终端无法启动')
  const user = userEvent.setup()
  render(<DeveloperModeSettings />)
  const control = screen.getByRole('switch', { name: '开发者模式' })
  await user.click(control)
  expect(await screen.findByRole('alert')).toHaveTextContent('终端无法启动')
  expect(control).not.toBeChecked()
  expect(control).toBeEnabled()
  await user.click(control)
  expect(control).toBeChecked()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('the terminal setting stays unavailable in a browser preview', async () => {
  vi.mocked(isDesktop).mockReturnValue(false)
  const user = userEvent.setup()
  render(<DeveloperModeSettings />)
  const control = screen.getByRole('switch', { name: '开发者模式' })
  expect(control).toHaveAttribute('aria-disabled', 'true')
  await user.click(control)
  expect(screen.getByText(/Windows 桌面应用/)).toBeVisible()
  expect(updateAppSettings).not.toHaveBeenCalled()
})
