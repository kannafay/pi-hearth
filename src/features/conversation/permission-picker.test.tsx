import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { PermissionPicker } from './permission-picker'
import { useConversationStore } from './store'

beforeEach(() => {
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})

test('permission options are ordered by risk and the current conversation alone changes', async () => {
  const changePermission = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({ status: 'ready', changePermission })
  const user = userEvent.setup()
  render(<PermissionPicker />)
  expect(screen.getByRole('combobox', { name: '会话权限' })).toHaveTextContent('询问模式')
  await user.tab()
  await user.keyboard(' ')
  const options = await screen.findAllByRole('option')
  expect(options.map((option) => option.textContent)).toEqual([
    expect.stringContaining('询问模式'),
    expect.stringContaining('模型自动判断'),
    expect.stringContaining('完全访问'),
  ])
  await user.click(options[1])
  expect(changePermission).toHaveBeenCalledExactlyOnceWith('auto')
})

test('connecting and pending selections stay usable and display the latest choice', () => {
  useConversationStore.setState({ status: 'connecting', permissionMode: 'auto' })
  render(<PermissionPicker />)
  const picker = screen.getByRole('combobox', { name: '会话权限' })
  expect(picker).toBeEnabled()
  expect(picker).toHaveTextContent('模型自动判断')
  act(() =>
    useConversationStore.setState({
      status: 'ready',
      settingsPending: 'permission',
      pendingSettings: { permissionMode: 'full' },
    }),
  )
  expect(picker).toBeEnabled()
  expect(picker).toHaveTextContent('完全访问')
})

test.each(['running', 'stopping', 'disconnected'] as const)(
  'permission changes are disabled while %s',
  (status) => {
    useConversationStore.setState({ status, permissionMode: 'auto' })
    render(<PermissionPicker />)
    expect(screen.getByRole('combobox', { name: '会话权限' })).toBeDisabled()
  },
)

test('read-only sessions cannot change their permission', () => {
  useConversationStore.setState({ status: 'ready', readOnly: '目录不存在' })
  render(<PermissionPicker />)
  expect(screen.getByRole('combobox', { name: '会话权限' })).toBeDisabled()
})
