import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { toast } from '@/lib/toast'
import { QueuedMessages } from './queued-messages'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
const messages = [
  { id: 'first', text: '稍后发送的问题', attachments: [] },
  { id: 'second', text: '另一个问题', attachments: [] },
]

beforeEach(() => vi.clearAllMocks())

test('queue changes update the count and keep an opened list usable', async () => {
  const user = userEvent.setup()
  const onRemove = vi.fn().mockResolvedValue(undefined)
  const view = render(
    <QueuedMessages messages={messages} connected disconnected={false} onRemove={onRemove} />,
  )
  const trigger = screen.getByRole('button', { name: '待发送消息' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('list', { name: '待发送消息列表' })).not.toBeInTheDocument()
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: '取消排队消息 2' }))
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('second')
  view.rerender(
    <QueuedMessages messages={[messages[0]]} connected disconnected={false} onRemove={onRemove} />,
  )
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('status')).toHaveTextContent('待发送 1 条')
  expect(screen.getByText('稍后发送的问题')).toBeVisible()
  await user.click(trigger)
  await waitFor(() => expect(screen.queryByRole('list')).not.toBeInTheDocument())
})

test('a disconnected queue remains readable and cannot cancel through a missing runtime', async () => {
  const user = userEvent.setup()
  const onRemove = vi.fn().mockResolvedValue(undefined)
  render(<QueuedMessages messages={messages} connected={false} disconnected onRemove={onRemove} />)
  expect(screen.getByText('连接已断开，消息仍保留')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '待发送消息' }))
  const cancel = screen.getByRole('button', { name: '取消排队消息 1' })
  expect(cancel).toBeDisabled()
  await user.click(cancel)
  expect(onRemove).not.toHaveBeenCalled()
  expect(screen.getByText('稍后发送的问题')).toBeVisible()
})

test('cancellation failures keep the list open and report the error', async () => {
  const user = userEvent.setup()
  const onRemove = vi.fn().mockRejectedValue('连接暂时不可用')
  render(<QueuedMessages messages={messages} connected disconnected={false} onRemove={onRemove} />)
  const trigger = screen.getByRole('button', { name: '待发送消息' })
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: '取消排队消息 1' }))
  expect(toast.error).toHaveBeenCalledExactlyOnceWith('连接暂时不可用')
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('稍后发送的问题')).toBeVisible()
})
