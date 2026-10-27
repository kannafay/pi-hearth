import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { DialogLayerProvider } from '@/components/dialog-layers'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/lib/toast'
import { Toaster } from './toast'

afterEach(() => vi.useRealTimers())

test('operation errors are portalled, deduplicated, and dismissible without taking input focus', async () => {
  const user = userEvent.setup()
  const { container } = render(
    <>
      <Toaster />
      <textarea aria-label="草稿" defaultValue="保留草稿" />
    </>,
  )
  const input = screen.getByRole('textbox', { name: '草稿' })
  await user.click(input)
  act(() => {
    toast.error(new Error('执行失败，请重试。'))
    toast.error('Error: 执行失败，请重试。')
  })
  const notice = screen.getByRole('dialog', { name: '执行失败，请重试。' })
  expect(notice).toHaveAttribute('data-type', 'error')
  expect(within(notice).queryByText('操作失败')).not.toBeInTheDocument()
  expect(within(notice).queryByRole('button', { name: '复制' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('region', { name: '操作通知' })).toContainElement(notice)
  expect(container).not.toContainElement(notice)
  expect(input).toHaveFocus()
  expect(input).toHaveValue('保留草稿')
  await user.hover(notice)
  expect(within(notice).getAllByRole('button')).toHaveLength(1)
  await user.click(within(notice).getByRole('button', { name: '关闭通知' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test.each([
  ['Nothing to compact (session too small)', '当前会话内容较少，暂时无需压缩。'],
  ['Already compacted', '当前上下文已压缩，暂时无需重复压缩。'],
])('compaction no-op %s becomes a friendly information notice', (reason, message) => {
  render(<Toaster />)
  act(() => {
    toast.error(reason)
    toast.error(new Error(`Error: ${reason}`))
  })
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('dialog', { name: message })).toHaveAttribute('data-type', 'info')
  expect(screen.queryByText(reason)).not.toBeInTheDocument()
})

test('successful results disappear automatically and can be shown again', async () => {
  vi.useFakeTimers()
  render(<Toaster />)
  act(() => toast.success('上下文已压缩'))
  expect(screen.getByRole('dialog', { name: '上下文已压缩' })).toBeVisible()
  await act(() => vi.advanceTimersByTimeAsync(3600))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  act(() => toast.success('上下文已压缩'))
  expect(screen.getByRole('dialog', { name: '上下文已压缩' })).toBeVisible()
})

test.each(['window blur', 'hover', 'keyboard focus'])(
  'operation results still expire after their timeout during %s',
  async (interaction) => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => toast.error('操作失败，需要重试'))
    const notice = screen.getByRole('dialog', { name: '操作失败，需要重试' })
    if (interaction === 'window blur') fireEvent.blur(window)
    if (interaction === 'hover') fireEvent.mouseEnter(notice)
    if (interaction === 'keyboard focus') fireEvent.keyDown(window, { key: 'F6' })
    await act(() => vi.advanceTimersByTimeAsync(6400))
    expect(notice).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  },
)

test('repeating the same result refreshes its timeout without an older timer dismissing it', async () => {
  vi.useFakeTimers()
  render(<Toaster />)
  act(() => toast.info('结果已更新'))
  await act(() => vi.advanceTimersByTimeAsync(3000))
  act(() => toast.info('结果已更新'))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(screen.getByRole('dialog', { name: '结果已更新' })).toBeVisible()
  await act(() => vi.advanceTimersByTimeAsync(2600))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('closing an operation notice preserves an open settings dialog', async () => {
  const changed = vi.fn()
  const user = userEvent.setup()
  render(
    <>
      <Toaster />
      <DialogLayerProvider>
        <Dialog defaultOpen onOpenChange={changed}>
          <DialogContent>
            <DialogTitle>设置</DialogTitle>
            <input aria-label="配置" defaultValue="保留配置" />
          </DialogContent>
        </Dialog>
      </DialogLayerProvider>
    </>,
  )
  act(() => toast.error('无法保存配置'))
  const notice = screen.getByRole('dialog', { name: '无法保存配置' })
  await user.hover(notice)
  await user.click(within(notice).getByRole('button', { name: '关闭通知' }))
  expect(screen.getByRole('dialog', { name: '设置' })).toBeVisible()
  expect(screen.getByRole('textbox', { name: '配置' })).toHaveValue('保留配置')
  expect(changed).not.toHaveBeenCalled()
})
