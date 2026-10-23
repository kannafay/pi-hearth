import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { ConversationTurn } from './conversation-turn'
import { buildConversationTurns } from './conversation-turns'
import { useConversationStore } from './store'
import { useWorkspaceStore } from '@/app/store'
import { messageTime } from './message-actions'
import type { ChatMessage } from '@/lib/generated/pi'

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}))
vi.mock('@streamdown/code', () => ({ code: {} }))
const prompt: ChatMessage = {
  id: 'prompt',
  role: 'user',
  text: '原来的消息',
  thinking: '',
  status: 'complete',
  error: null,
  timestamp: 1_790_000_000_000,
}
const reply: ChatMessage = {
  id: 'reply',
  role: 'assistant',
  text: '**Markdown 回复**',
  thinking: '',
  status: 'complete',
  error: null,
  timestamp: 1_790_000_001_000,
}
function view(active = false) {
  return render(
    <ConversationTurn
      turn={buildConversationTurns([prompt, reply], [], [])[0]}
      active={active}
      onActionStart={vi.fn()}
    />,
  )
}

beforeEach(() => {
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState({
    instanceId: 'pi-1',
    status: 'ready',
    rewrite: vi.fn().mockResolvedValue(true),
  })
})

test('timestamps and copy actions sit below the content and copy the original Markdown', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const { container } = view()
  const own = screen.getByRole('article', { name: '你的消息' })
  const answer = screen.getByRole('article', { name: 'Pi 的回复' })
  expect(container.querySelectorAll('time')).toHaveLength(2)
  expect(own.querySelector('.user-message-bubble')).not.toContainElement(
    within(own).getByRole('group', { name: '消息操作' }),
  )
  await user.click(within(answer).getByRole('button', { name: '复制回复' }))
  expect(write).toHaveBeenCalledWith(reply.text)
  expect(within(answer).getByRole('status')).toHaveTextContent('已复制')
  expect(messageTime(undefined)).toBeNull()
  expect(messageTime(Number.NaN)).toBeNull()
})

test('editing can cancel without changing the composer and saves from the selected original message', async () => {
  const user = userEvent.setup()
  useWorkspaceStore.setState({ draft: '尚未发送的草稿' })
  view()
  await user.click(screen.getByRole('button', { name: '编辑消息' }))
  expect(screen.getByRole('textbox', { name: '编辑消息内容' })).toHaveFocus()
  await user.clear(screen.getByRole('textbox', { name: '编辑消息内容' }))
  await user.type(screen.getByRole('textbox', { name: '编辑消息内容' }), '取消的内容')
  await user.click(screen.getByRole('button', { name: '取消' }))
  expect(screen.getByText(prompt.text)).toBeVisible()
  expect(useConversationStore.getState().rewrite).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().draft).toBe('尚未发送的草稿')
  await user.click(screen.getByRole('button', { name: '编辑消息' }))
  await user.clear(screen.getByRole('textbox', { name: '编辑消息内容' }))
  await user.type(screen.getByRole('textbox', { name: '编辑消息内容' }), '改过的消息')
  await user.click(screen.getByRole('button', { name: '保存并发送' }))
  expect(useConversationStore.getState().rewrite).toHaveBeenCalledWith(prompt.id, '改过的消息')
})

test('regenerate targets its own turn and stays unavailable during other runs and read-only viewing', async () => {
  const user = userEvent.setup()
  view()
  await user.click(screen.getByRole('button', { name: '重新回答' }))
  const dialog = await screen.findByRole('dialog', { name: '重新回答？' })
  expect(useConversationStore.getState().rewrite).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: '取消' }))
  expect(useConversationStore.getState().rewrite).not.toHaveBeenCalled()
  await screen.findByRole('button', { name: '重新回答' })
  await user.click(screen.getByRole('button', { name: '重新回答' }))
  await user.click(await screen.findByRole('button', { name: '确认重新回答' }))
  expect(useConversationStore.getState().rewrite).toHaveBeenCalledWith(prompt.id)
  act(() => useConversationStore.setState({ status: 'running' }))
  expect(screen.getByRole('button', { name: '重新回答' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '编辑消息' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '复制回复' })).toBeEnabled()
  act(() => useConversationStore.setState({ status: 'ready', readOnly: 'missing directory' }))
  expect(screen.getByRole('button', { name: '重新回答' })).toBeDisabled()
})
