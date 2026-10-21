import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useTheme } from '@/app/use-theme'
import { SettingsDialog } from '@/features/settings/settings-dialog'
import { getAppVersion, isDesktop, setWindowTheme } from '@/lib/desktop'

vi.mock('@/lib/desktop', () => ({
  getAppVersion: vi.fn(),
  isDesktop: vi.fn(),
  setWindowTheme: vi.fn().mockResolvedValue(undefined),
}))

function SettingsHarness() {
  useTheme()
  return <SettingsDialog open onOpenChange={() => {}} />
}

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(isDesktop).mockReturnValue(false)
  vi.mocked(getAppVersion).mockReset()
  vi.mocked(setWindowTheme).mockClear()
})

test('browser preview shows its limits without invoking the desktop bridge', async () => {
  const user = userEvent.setup()
  render(<SettingsHarness />)
  await user.click(screen.getByRole('tab', { name: '运行诊断' }))
  expect(screen.getByText(/当前为浏览器预览/)).toBeVisible()
  expect(getAppVersion).not.toHaveBeenCalled()
})

test('desktop diagnostics displays the version returned by Rust', async () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.mocked(getAppVersion).mockResolvedValue('0.1.0')
  const user = userEvent.setup()
  render(<SettingsHarness />)
  await user.click(screen.getByRole('tab', { name: '运行诊断' }))
  expect(await screen.findByText('已连接桌面核心，版本 0.1.0')).toBeVisible()
})

test('a failed desktop command is visible while settings remains usable', async () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.mocked(getAppVersion).mockRejectedValue(new Error('IPC unavailable'))
  const user = userEvent.setup()
  render(<SettingsHarness />)
  await user.click(screen.getByRole('tab', { name: '运行诊断' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('IPC unavailable')
  await user.click(screen.getByRole('tab', { name: '外观' }))
  expect(screen.getByRole('combobox', { name: '界面主题' })).toBeVisible()
})

test('theme selection updates the document and can return to the system theme', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  const user = userEvent.setup()
  render(<SettingsHarness />)
  await waitFor(() => expect(screen.getByRole('tab', { name: '外观' })).toHaveFocus())
  await user.click(screen.getByRole('combobox', { name: '界面主题' }))
  await user.click(await screen.findByRole('option', { name: '深色' }))
  expect(document.documentElement).toHaveClass('dark')
  expect(useWorkspaceStore.getState().theme).toBe('dark')
  expect(setWindowTheme).toHaveBeenLastCalledWith('dark')
  await waitFor(() => expect(screen.getByRole('combobox', { name: '界面主题' })).toHaveFocus())
  await user.click(screen.getByRole('combobox', { name: '界面主题' }))
  await user.click(await screen.findByRole('option', { name: '跟随系统' }))
  expect(document.documentElement).not.toHaveClass('dark')
  expect(useWorkspaceStore.getState().theme).toBe('system')
  expect(setWindowTheme).toHaveBeenLastCalledWith(null)
})

test('vertical settings tabs use arrows and Enter, and closing restores focus', async () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>打开设置</button>
        <SettingsDialog open={open} onOpenChange={setOpen} />
      </>
    )
  }
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: '打开设置' }))
  await waitFor(() => expect(screen.getByRole('tab', { name: '外观' })).toHaveFocus())
  expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('tab', { name: '模型与凭证' })).toHaveFocus()
  expect(screen.getByRole('tab', { name: '外观' })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{Enter}')
  expect(screen.getByRole('tabpanel', { name: '模型与凭证' })).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('button', { name: '打开设置' })).toHaveFocus())
})
