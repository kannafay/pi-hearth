import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useConversationStore } from '@/features/conversation/store'
import { useWorkspaceStore } from '@/app/store'
import { updateAppSettings } from '@/lib/app-settings'
import type { AppSettings } from '@/lib/generated/pi'
import { PermissionSettings } from './permission-settings'

vi.mock('@/lib/app-settings', () => ({ loadAppSettings: vi.fn(), updateAppSettings: vi.fn() }))
vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.setState({ settingsReady: true })
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ permissionMode: 'full', status: 'running' })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  vi.mocked(updateAppSettings).mockImplementation(
    async (patch) => ({ defaultPermission: patch.defaultPermission }) as AppSettings,
  )
})

test('the new-chat default saves independently while the current conversation keeps its permission', async () => {
  const user = userEvent.setup()
  render(<PermissionSettings />)
  expect(screen.getByText('仅用于之后新建的对话，已有会话保留各自的权限。')).toBeVisible()
  await user.tab()
  await user.keyboard(' ')
  await user.click(await screen.findByRole('option', { name: '模型自动判断' }))
  await waitFor(() => expect(useWorkspaceStore.getState().defaultPermission).toBe('auto'))
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({ defaultPermission: 'auto' })
  expect(useConversationStore.getState().permissionMode).toBe('full')
})

test('default permission waits for startup settings and disables duplicate writes', () => {
  useWorkspaceStore.setState({ settingsReady: false })
  const view = render(<PermissionSettings />)
  expect(screen.getByRole('combobox', { name: '新对话默认权限' })).toBeDisabled()
  view.unmount()
  useWorkspaceStore.setState({ settingsReady: true, defaultPermissionPending: true })
  render(<PermissionSettings />)
  expect(screen.getByRole('combobox', { name: '新对话默认权限' })).toBeDisabled()
})
