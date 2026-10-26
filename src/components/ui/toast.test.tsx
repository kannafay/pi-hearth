import { act, render, screen, within } from '@testing-library/react'
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
  const notice = screen.getByRole('dialog', { name: '操作失败' })
  expect(notice).toHaveAccessibleDescription('执行失败，请重试。')
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('region', { name: '操作通知' })).toContainElement(notice)
  expect(container).not.toContainElement(notice)
  expect(input).toHaveFocus()
  expect(input).toHaveValue('保留草稿')
  await user.hover(notice)
  await user.click(within(notice).getByRole('button', { name: '关闭通知' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('successful results disappear automatically and can be shown again', async () => {
  vi.useFakeTimers()
  render(<Toaster />)
  act(() => toast.success('上下文已压缩'))
  expect(screen.getByRole('dialog', { name: '操作成功' })).toHaveAccessibleDescription(
    '上下文已压缩',
  )
  await act(() => vi.advanceTimersByTimeAsync(3600))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  act(() => toast.success('上下文已压缩'))
  expect(screen.getByRole('dialog', { name: '操作成功' })).toHaveAccessibleDescription(
    '上下文已压缩',
  )
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
  const notice = screen.getByRole('dialog', { name: '操作失败' })
  expect(notice).toHaveAccessibleDescription('无法保存配置')
  await user.hover(notice)
  await user.click(within(notice).getByRole('button', { name: '关闭通知' }))
  expect(screen.getByRole('dialog', { name: '设置' })).toBeVisible()
  expect(screen.getByRole('textbox', { name: '配置' })).toHaveValue('保留配置')
  expect(changed).not.toHaveBeenCalled()
})

test('error details can be copied and a failed copy can be retried without losing the message', async () => {
  const user = userEvent.setup()
  const writeText = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValueOnce(new Error('Clipboard unavailable'))
    .mockResolvedValueOnce(undefined)
  render(<Toaster />)
  act(() => toast.error('Error: 配置文件读取失败'))
  const notice = screen.getByRole('dialog', { name: '操作失败' })
  await user.click(within(notice).getByRole('button', { name: '复制' }))
  expect(notice).toHaveAccessibleDescription('配置文件读取失败')
  await user.click(await within(notice).findByRole('button', { name: '复制失败' }))
  expect(await within(notice).findByRole('button', { name: '已复制' })).toBeDisabled()
  expect(writeText).toHaveBeenNthCalledWith(1, '配置文件读取失败')
  expect(writeText).toHaveBeenNthCalledWith(2, '配置文件读取失败')
})
