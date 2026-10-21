import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
        payload: {
          type: string
          epoch: number
          dark?: boolean
          key?: string
          shift?: boolean
          origin?: string
        }
      }) => void),
}))

let frames: Map<number, FrameRequestCallback>
let nextFrame: number

function paint() {
  act(() => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(0))
  })
}

function finishFade() {
  const event = new Event('transitionend', { bubbles: true })
  Object.defineProperty(event, 'propertyName', { value: 'opacity' })
  fireEvent(screen.getByRole('menu'), event)
}

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
  frames = new Map()
  nextFrame = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
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
  act(() =>
    bridge.receive?.({
      payload: { type: 'open', epoch: 7, dark: true, origin: 'right bottom' },
    }),
  )
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('tray_present', { epoch: 7 }))
  expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'preparing')
  expect(screen.getByRole('menu')).toHaveStyle({ transformOrigin: 'right bottom' })
  expect(screen.getByRole('menuitem', { name: '界面' })).toBeDisabled()
  act(() => bridge.receive?.({ payload: { type: 'shown', epoch: 7 } }))
  paint()
  expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'preparing')
  paint()
  expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'open')
  act(() => bridge.receive?.({ payload: { type: 'key', epoch: 6, key: 'ArrowDown' } }))
  expect(screen.getByRole('menu')).not.toHaveAttribute('aria-activedescendant')
  act(() => bridge.receive?.({ payload: { type: 'key', epoch: 7, key: 'ArrowDown' } }))
  act(() => bridge.receive?.({ payload: { type: 'key', epoch: 7, key: 'Enter' } }))
  await waitFor(() =>
    expect(bridge.invoke).toHaveBeenCalledWith('tray_action', { epoch: 7, action: 'show' }),
  )
  bridge.invoke.mockResolvedValue(undefined)
  act(() =>
    bridge.receive?.({ payload: { type: 'open', epoch: 9, dark: false, origin: 'left top' } }),
  )
  expect(document.documentElement).not.toHaveClass('dark')
  expect(screen.getByRole('menu')).not.toHaveAttribute('aria-activedescendant')
  act(() => bridge.receive?.({ payload: { type: 'shown', epoch: 9 } }))
  paint()
  paint()
  await user.keyboard('{Escape}')
  expect(bridge.invoke).toHaveBeenCalledWith('tray_dismiss', { epoch: 9 })
  act(() => bridge.receive?.({ payload: { type: 'close', epoch: 9 } }))
  expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'closing')
  expect(bridge.invoke).not.toHaveBeenCalledWith('tray_closed', { epoch: 9 })
  expect(screen.getByRole('menuitem', { name: '界面' })).toBeDisabled()
  const presentations = bridge.invoke.mock.calls.filter(
    ([command, args]) => command === 'tray_present' && args.epoch === 9,
  )
  expect(presentations).toHaveLength(1)
  finishFade()
  expect(bridge.invoke).toHaveBeenCalledWith('tray_closed', { epoch: 9 })
  view.unmount()
  await waitFor(() => expect(bridge.unlisten).toHaveBeenCalledOnce())
  bridge.invoke.mockClear()
  act(() => bridge.receive?.({ payload: { type: 'open', epoch: 10, dark: true } }))
  expect(bridge.invoke).not.toHaveBeenCalled()
})

test('closing during preparation cancels reveal and stale animation signals cannot close a reopened menu', async () => {
  bridge.native = true
  render(<TrayMenuApp />)
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('tray_ready'))
  act(() =>
    bridge.receive?.({ payload: { type: 'open', epoch: 3, dark: false, origin: 'left bottom' } }),
  )
  act(() => bridge.receive?.({ payload: { type: 'shown', epoch: 3 } }))
  paint()
  act(() => bridge.receive?.({ payload: { type: 'close', epoch: 3 } }))
  expect(bridge.invoke).toHaveBeenCalledWith('tray_closed', { epoch: 3 })
  expect(frames.size).toBe(0)
  act(() =>
    bridge.receive?.({ payload: { type: 'open', epoch: 5, dark: false, origin: 'right top' } }),
  )
  act(() => bridge.receive?.({ payload: { type: 'shown', epoch: 3 } }))
  act(() => bridge.receive?.({ payload: { type: 'close', epoch: 3 } }))
  expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'preparing')
  act(() => bridge.receive?.({ payload: { type: 'shown', epoch: 5 } }))
  paint()
  paint()
  act(() => bridge.receive?.({ payload: { type: 'close', epoch: 5 } }))
  act(() =>
    bridge.receive?.({ payload: { type: 'open', epoch: 7, dark: false, origin: 'left top' } }),
  )
  bridge.invoke.mockClear()
  finishFade()
  expect(bridge.invoke).not.toHaveBeenCalledWith('tray_closed', { epoch: 5 })
  expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'preparing')
})

test('reduced motion reveals immediately and hides without waiting for a transition', async () => {
  bridge.native = true
  const matchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...matchMedia(query),
    matches: query === '(prefers-reduced-motion: reduce)',
  }))
  render(<TrayMenuApp />)
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('tray_ready'))
  act(() =>
    bridge.receive?.({ payload: { type: 'open', epoch: 3, dark: false, origin: 'left top' } }),
  )
  act(() => bridge.receive?.({ payload: { type: 'shown', epoch: 3 } }))
  expect(frames.size).toBe(0)
  expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'open')
  act(() => bridge.receive?.({ payload: { type: 'close', epoch: 3 } }))
  expect(bridge.invoke).toHaveBeenCalledWith('tray_closed', { epoch: 3 })
})
