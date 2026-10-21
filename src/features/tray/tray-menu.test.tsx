import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { TrayMenu } from './tray-menu'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }))

test('the tray menu supports arrows, Enter, and Escape without closing on a pending action', async () => {
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
  const show = await screen.findByRole('menuitem', { name: '界面' })
  await waitFor(() => expect(show).toHaveFocus())
  await user.keyboard('{ArrowDown}{Enter}')
  expect(onAction).toHaveBeenCalledWith('restart')
  expect(screen.getByRole('menuitem', { name: '重启' })).toHaveAttribute('aria-disabled', 'true')
  expect(onDismiss).not.toHaveBeenCalled()
  await act(async () => {
    finish()
  })
  show.focus()
  await user.keyboard('{Escape}')
  expect(onDismiss).toHaveBeenCalledOnce()
})

test('exit is separated and a failed action can be retried without changing the menu size', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const onAction = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue(undefined)
  const user = userEvent.setup()
  render(<TrayMenu onAction={onAction} onDismiss={vi.fn()} />)
  expect(await screen.findByRole('separator')).toBeInTheDocument()
  const quit = screen.getByRole('menuitem', { name: '退出' })
  expect(quit).toHaveAttribute('data-variant', 'destructive')
  await user.click(quit)
  await user.click(await screen.findByRole('menuitem', { name: '退出失败，请重试' }))
  expect(onAction).toHaveBeenNthCalledWith(1, 'quit')
  expect(onAction).toHaveBeenNthCalledWith(2, 'quit')
  await waitFor(() =>
    expect(screen.getByRole('menuitem', { name: '退出' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  )
  vi.restoreAllMocks()
})
