import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useTheme } from '@/app/use-theme'
import { useMediaQuery } from '@/app/use-media-query'
import { SettingsDialog } from '@/features/settings/settings-dialog'
import { getAppVersion, isDesktop, setWindowTheme } from '@/lib/desktop'

vi.mock('@/lib/desktop', () => ({
  getAppVersion: vi.fn(),
  isDesktop: vi.fn(),
  setWindowTheme: vi.fn().mockResolvedValue(undefined),
  openDeveloperConsole: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/use-media-query', () => ({ useMediaQuery: vi.fn() }))
vi.mock('@/lib/system-theme', () => ({
  usesNativeSystemTheme: () => true,
  observeSystemTheme: async (onChange: (dark: boolean) => void) => {
    onChange(false)
    return () => {}
  },
}))

function SettingsHarness() {
  useTheme()
  return <SettingsDialog open onOpenChange={() => {}} />
}

beforeEach(() => {
  vi.mocked(useMediaQuery).mockReturnValue(false)
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(isDesktop).mockReturnValue(false)
  vi.mocked(getAppVersion).mockReset()
  vi.mocked(setWindowTheme).mockClear()
})

test('browser preview shows its limits without invoking the desktop bridge', async () => {
  const user = userEvent.setup()
  render(<SettingsHarness />)
  await user.click(screen.getByRole('tab', { name: '存储' }))
  expect(screen.getByRole('heading', { name: '存储' })).toBeVisible()
  expect(screen.getByText('新项目保存位置')).toBeVisible()
  expect(screen.getByRole('combobox', { name: '文件保存位置' })).toBeVisible()
  expect(screen.getByRole('combobox', { name: '文件保存位置' })).toBeDisabled()
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
  expect(setWindowTheme).toHaveBeenLastCalledWith('light')
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
  await user.click(screen.getByRole('button', { name: '打开设置' }))
  expect(screen.getByRole('tab', { name: '外观' })).toHaveAttribute('aria-selected', 'true')
})

test('compact navigation switches pages and preserves archive selection across window layouts', async () => {
  let compact = true
  vi.mocked(useMediaQuery).mockImplementation(() => compact)
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.mocked(getAppVersion).mockResolvedValue('0.1.0')
  const session = {
    id: 'compact',
    path: 'compact.jsonl',
    cwd: 'general',
    title: '保留归档选择',
    modified: 0,
    messageCount: 2,
  }
  useWorkspaceStore.setState({
    sessions: [session],
    sessionPreferences: { [session.path]: { pinned: false, archived: true } },
  })
  const user = userEvent.setup()
  const view = render(<SettingsHarness />)
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('combobox', { name: '设置分类' })).toHaveFocus())
  await user.keyboard('{ArrowDown}')
  await user.click(await screen.findByRole('option', { name: '归档' }))
  const panel = screen.getByRole('tabpanel', { name: '归档' })
  const checkbox = screen.getByRole('checkbox', { name: '选择 保留归档选择' })
  await user.click(checkbox)
  expect(checkbox).toBeChecked()

  compact = false
  view.rerender(<SettingsHarness />)
  expect(screen.queryByRole('combobox', { name: '设置分类' })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '归档' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tabpanel', { name: '归档' })).toBe(panel)
  expect(screen.getByRole('checkbox', { name: '选择 保留归档选择' })).toBe(checkbox)
  expect(checkbox).toBeChecked()

  compact = true
  view.rerender(<SettingsHarness />)
  expect(screen.getByRole('combobox', { name: '设置分类' })).toHaveTextContent('归档')
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  expect(screen.getByRole('tabpanel', { name: '归档' })).toBe(panel)
  expect(checkbox).toBeChecked()
  expect(screen.getByRole('button', { name: '恢复所选' })).toBeVisible()
})

test('the archive settings page restores conversations without deleting native sessions', async () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.mocked(getAppVersion).mockResolvedValue('0.1.0')
  const session = {
    path: 'archived.jsonl',
    id: 'archived',
    cwd: 'general',
    title: '已归档的讨论',
    modified: Date.now(),
    messageCount: 2,
  }
  const setSessionArchived = vi.fn(async () => {
    useWorkspaceStore.setState({ sessionPreferences: {} })
    return true
  })
  useWorkspaceStore.setState({
    sessions: [session],
    sessionPreferences: { [session.path]: { pinned: true, archived: true } },
    setSessionArchived,
  })
  const user = userEvent.setup()
  render(<SettingsHarness />)
  await user.click(screen.getByRole('tab', { name: '归档' }))
  expect(screen.getByRole('heading', { name: '归档' })).toBeVisible()
  expect(screen.getByText(session.title)).toBeVisible()
  await user.click(screen.getByRole('button', { name: `恢复 ${session.title}` }))
  expect(setSessionArchived).toHaveBeenCalledExactlyOnceWith(session, false)
  expect(await screen.findByText('暂无归档会话')).toBeVisible()
  expect(useWorkspaceStore.getState().sessions).toEqual([session])
})

test('a failed archive restore displays its error inside settings and permits retry', async () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.mocked(getAppVersion).mockResolvedValue('0.1.0')
  const session = {
    path: 'archived.jsonl',
    id: 'archived',
    cwd: 'general',
    title: '需要恢复',
    modified: 1,
    messageCount: 1,
  }
  useWorkspaceStore.setState({
    sessions: [session],
    sessionPreferences: { [session.path]: { pinned: false, archived: true } },
    error: '无法保存工作台配置',
    setSessionArchived: vi.fn().mockResolvedValue(false),
  })
  const user = userEvent.setup()
  render(<SettingsHarness />)
  await user.click(screen.getByRole('tab', { name: '归档' }))
  await user.click(screen.getByRole('button', { name: `恢复 ${session.title}` }))
  expect(await screen.findByRole('alert')).toHaveTextContent('无法保存工作台配置')
  expect(screen.getByRole('button', { name: `恢复 ${session.title}` })).toBeEnabled()
})
