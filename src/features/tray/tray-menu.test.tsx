import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TrayMenu, TrayMenuApp } from './tray-menu'

const bridge = vi.hoisted(() => ({
  native: false,
  invoke: vi.fn().mockResolvedValue(undefined),
  unlisten: vi.fn(),
  receive: null as
    | null
    | ((event: {
        payload: { type: string; epoch: number; dark?: boolean; key?: string; shift?: boolean }
      }) => void),
}))

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => bridge.native,
  invoke: (...args: unknown[]) => bridge.invoke(...args),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, receive: NonNullable<typeof bridge.receive>) => {
    bridge.receive = receive
    return bridge.unlisten
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  bridge.native = false
  bridge.receive = null
  bridge.invoke.mockResolvedValue(undefined)
  document.documentElement.classList.remove('dark')
})
afterEach(() => vi.restoreAllMocks())

test('keyboard navigation highlights actions without grabbing focus and pending actions cannot repeat', async () => {
  let finish!: () => void
  const onAction = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const onDismiss = vi.fn()
  const user = userEvent.setup()
  render(<TrayMenu onAction={onAction} onDismiss={onDismiss} />)
  const show = screen.getByRole('menuitem', { name: '界面' })
  expect(show).not.toHaveFocus()
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}{Enter}')
  expect(onAction).toHaveBeenCalledExactlyOnceWith('restart')
  expect(screen.getByRole('menuitem', { name: '重启' })).toBeDisabled()
  expect(onDismiss).not.toHaveBeenCalled()
  await act(async () => finish())
  await user.keyboard('{End}{ArrowDown}')
  expect(show).toHaveAttribute('data-highlighted')
  await user.keyboard('{ArrowUp}')
  expect(screen.getByRole('menuitem', { name: '退出' })).toHaveAttribute('data-highlighted')
  await user.keyboard('{Home}{Shift>}{Tab}{/Shift}{Escape}')
  expect(onDismiss).toHaveBeenCalledOnce()
  expect(show).not.toHaveFocus()
})

test('pointer selection keeps focus outside the popup and failed actions can be retried', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const onAction = vi.fn().mockRejectedValueOnce('failed').mockResolvedValue(undefined)
  const user = userEvent.setup()
  render(<TrayMenu onAction={onAction} onDismiss={vi.fn()} />)
  expect(screen.getByRole('separator')).toBeInTheDocument()
  const quit = screen.getByRole('menuitem', { name: '退出' })
  expect(quit).toHaveAttribute('data-destructive')
  await user.click(quit)
  expect(quit).not.toHaveFocus()
  await user.click(await screen.findByRole('menuitem', { name: '退出失败，请重试' }))
  expect(onAction).toHaveBeenNthCalledWith(1, 'quit')
  expect(onAction).toHaveBeenNthCalledWith(2, 'quit')
  await waitFor(() => expect(screen.getByRole('menuitem', { name: '退出' })).toBeEnabled())
})

test('the native handshake renders the theme before showing and old menu events cannot activate new actions', async () => {
  bridge.native = true
  const user = userEvent.setup()
  const view = render(<TrayMenuApp />)
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('tray_ready'))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  bridge.invoke.mockImplementation(async (command) => {
    if (command === 'tray_present') {
      expect(screen.getByRole('menu', { name: 'Pi Hearth' })).toBeInTheDocument()
      expect(document.documentElement).toHaveClass('dark')
    }
  })
  act(() => bridge.receive?.({ payload: { type: 'open', epoch: 7, dark: true } }))
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('tray_present', { epoch: 7 }))
  act(() => bridge.receive?.({ payload: { type: 'key', epoch: 6, key: 'ArrowDown' } }))
  expect(screen.getByRole('menu')).not.toHaveAttribute('aria-activedescendant')
  act(() => bridge.receive?.({ payload: { type: 'key', epoch: 7, key: 'ArrowDown' } }))
  act(() => bridge.receive?.({ payload: { type: 'key', epoch: 7, key: 'Enter' } }))
  await waitFor(() =>
    expect(bridge.invoke).toHaveBeenCalledWith('tray_action', { epoch: 7, action: 'show' }),
  )
  bridge.invoke.mockResolvedValue(undefined)
  act(() => bridge.receive?.({ payload: { type: 'open', epoch: 9, dark: false } }))
  expect(document.documentElement).not.toHaveClass('dark')
  expect(screen.getByRole('menu')).not.toHaveAttribute('aria-activedescendant')
  await user.keyboard('{Escape}')
  expect(bridge.invoke).toHaveBeenCalledWith('tray_dismiss', { epoch: 9 })
  view.unmount()
  await waitFor(() => expect(bridge.unlisten).toHaveBeenCalledOnce())
  bridge.invoke.mockClear()
  act(() => bridge.receive?.({ payload: { type: 'open', epoch: 10, dark: true } }))
  expect(bridge.invoke).not.toHaveBeenCalled()
})
