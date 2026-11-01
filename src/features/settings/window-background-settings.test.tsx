import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { updateAppSettings } from '@/lib/app-settings'
import { isDesktop } from '@/lib/desktop'
import { usesNativeSystemTheme } from '@/lib/system-theme'
import type { AppSettings } from '@/lib/generated/pi'
import { WindowBackgroundSettings } from './window-background-settings'

vi.mock('@/lib/app-settings', () => ({ updateAppSettings: vi.fn(), loadAppSettings: vi.fn() }))
vi.mock('@/lib/desktop', () => ({ isDesktop: vi.fn() }))
vi.mock('@/lib/system-theme', () => ({ usesNativeSystemTheme: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  Element.prototype.scrollIntoView = vi.fn()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.mocked(usesNativeSystemTheme).mockReturnValue(true)
  vi.mocked(updateAppSettings).mockImplementation(
    async (patch) => ({ windowBackground: patch.windowBackground }) as AppSettings,
  )
})

test('all three materials can be selected and save independently of the color theme', async () => {
  useWorkspaceStore.setState({ theme: 'dark' })
  const user = userEvent.setup()
  render(<WindowBackgroundSettings />)
  const control = screen.getByRole('combobox', { name: '窗口背景' })
  expect(control).toHaveTextContent('云母')
  for (const [label, value] of [
    ['毛玻璃', 'acrylic'],
    ['纯色', 'solid'],
    ['云母', 'mica'],
  ]) {
    await user.click(control)
    await user.click(await screen.findByRole('option', { name: label }))
    expect(control).toHaveTextContent(label)
    expect(updateAppSettings).toHaveBeenLastCalledWith({ windowBackground: value })
    expect(useWorkspaceStore.getState().theme).toBe('dark')
  }
  expect(updateAppSettings).toHaveBeenCalledTimes(3)
})

test('the saved material stays selected and the control is disabled until saving completes', async () => {
  let finish!: (settings: AppSettings) => void
  vi.mocked(updateAppSettings).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
  const user = userEvent.setup()
  render(<WindowBackgroundSettings />)
  const control = screen.getByRole('combobox', { name: '窗口背景' })
  await user.click(control)
  await user.click(await screen.findByRole('option', { name: '毛玻璃' }))
  expect(control).toBeDisabled()
  expect(control).toHaveTextContent('云母')
  expect(control).toHaveAttribute('aria-busy', 'true')
  await user.click(control)
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({ windowBackground: 'acrylic' })
  await act(async () => finish({ windowBackground: 'acrylic' } as AppSettings))
  expect(control).toBeEnabled()
  expect(control).toHaveTextContent('毛玻璃')
  expect(control).toHaveAccessibleDescription('模糊透出窗口下方的内容，切换后立即生效。')
})

test('a failed save retains the material and shows a retryable error', async () => {
  vi.mocked(updateAppSettings).mockRejectedValueOnce('disk full')
  const user = userEvent.setup()
  render(<WindowBackgroundSettings />)
  const control = screen.getByRole('combobox', { name: '窗口背景' })
  await user.click(control)
  await user.click(await screen.findByRole('option', { name: '纯色' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('无法保存窗口背景：disk full')
  expect(control).toBeEnabled()
  expect(control).toHaveTextContent('云母')
  await user.click(control)
  await user.click(await screen.findByRole('option', { name: '纯色' }))
  expect(control).toHaveTextContent('纯色')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test.each([
  { desktop: false, native: true },
  { desktop: true, native: false },
])(
  'unsupported previews and platforms do not save a material ($desktop, $native)',
  async ({ desktop, native }) => {
    vi.mocked(isDesktop).mockReturnValue(desktop)
    vi.mocked(usesNativeSystemTheme).mockReturnValue(native)
    const user = userEvent.setup()
    render(<WindowBackgroundSettings />)
    const control = screen.getByRole('combobox', { name: '窗口背景' })
    expect(control).toBeDisabled()
    expect(control).toHaveAccessibleDescription('窗口背景材质仅在 Windows 桌面应用中可用。')
    await user.click(control)
    expect(updateAppSettings).not.toHaveBeenCalled()
  },
)
