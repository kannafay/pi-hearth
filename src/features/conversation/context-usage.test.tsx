import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { compactPi } from '@/lib/composer'
import { ContextUsageIndicator } from './context-usage'
import { useConversationStore, type ConversationData } from './store'

vi.mock('@/lib/composer', () => ({ compactPi: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(compactPi).mockResolvedValue(undefined)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({
    status: 'ready',
    sessionId: 'current',
    instanceId: 'runtime',
    messages: [
      {
        id: 'previous',
        role: 'user',
        text: 'Earlier',
        thinking: '',
        status: 'complete',
        error: null,
      },
    ],
  })
})

test('only the ring is visible until hover reveals the percentage and tokens without stealing focus', async () => {
  useConversationStore.setState({
    contextUsage: { tokens: 12000, contextWindow: 200000, percent: 6 },
  })
  const user = userEvent.setup()
  render(
    <>
      <textarea aria-label="草稿" />
      <ContextUsageIndicator />
    </>,
  )
  const draft = screen.getByRole('textbox')
  await user.click(draft)
  const trigger = screen.getByRole('button', { name: '上下文用量' })
  expect(trigger).toHaveTextContent('')
  expect(screen.queryByText('6%')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.hover(trigger)
  const details = await screen.findByRole('dialog', { name: '上下文用量' })
  expect(within(details).getByText('6%')).toBeInTheDocument()
  expect(within(details).getByText('12,000 tokens')).toBeInTheDocument()
  expect(within(details).getByText('188,000 tokens')).toBeInTheDocument()
  expect(within(details).getByText('200,000 tokens')).toBeInTheDocument()
  expect(draft).toHaveFocus()
  await user.unhover(trigger)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('unknown usage after compaction keeps the window size and does not pretend to be zero', async () => {
  useConversationStore.setState({
    contextUsage: { tokens: null, contextWindow: 128000, percent: null },
  })
  const user = userEvent.setup()
  render(<ContextUsageIndicator />)
  await user.click(screen.getByRole('button', { name: '上下文用量' }))
  const details = screen.getByRole('dialog', { name: '上下文用量' })
  expect(within(details).getByText('128,000 tokens')).toBeInTheDocument()
  expect(within(details).getByText(/等待下一次回复/)).toBeInTheDocument()
  expect(screen.queryByText('0%')).not.toBeInTheDocument()
})

test('zero is valid, percentages update in place, and an overfull ring stays bounded', async () => {
  const user = userEvent.setup()
  useConversationStore.setState({ contextUsage: { tokens: 0, contextWindow: 100, percent: 0 } })
  render(<ContextUsageIndicator />)
  await user.click(screen.getByRole('button', { name: '上下文用量' }))
  act(() => {
    useConversationStore.setState({
      contextUsage: { tokens: 105, contextWindow: 100, percent: 105 },
    })
  })
  const trigger = screen.getByRole('button', { name: '上下文用量' })
  expect(within(screen.getByRole('dialog')).getByText('105%')).toBeInTheDocument()
  expect(trigger.querySelector('[stroke-dashoffset]')).toHaveAttribute('stroke-dashoffset', '0')
  expect(within(screen.getByRole('dialog')).getByText('0 tokens')).toBeInTheDocument()
})

test('session changes close the old details and keyboard users can inspect unavailable usage', async () => {
  const user = userEvent.setup()
  render(<ContextUsageIndicator />)
  await user.tab()
  await user.keyboard(' ')
  expect(screen.getByRole('dialog')).toHaveTextContent('暂未获取到当前会话的上下文用量')
  act(() => useConversationStore.setState({ sessionId: 'next' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('the compaction button asks for confirmation and cancelling leaves the session untouched', async () => {
  const user = userEvent.setup()
  render(<ContextUsageIndicator />)
  await user.hover(screen.getByRole('button', { name: '上下文用量' }))
  const details = await screen.findByRole('dialog', { name: '上下文用量' })
  await user.click(within(details).getByRole('button', { name: '压缩上下文' }))
  const confirmation = await screen.findByRole('dialog', { name: '压缩当前会话？' })
  expect(confirmation).toHaveTextContent('将较早的对话整理为摘要，保留近期消息。')
  expect(compactPi).not.toHaveBeenCalled()
  await user.click(within(confirmation).getByRole('button', { name: '取消' }))
  expect(screen.queryByRole('dialog', { name: '压缩当前会话？' })).not.toBeInTheDocument()
  expect(compactPi).not.toHaveBeenCalled()
  expect(useConversationStore.getState().status).toBe('ready')
})

test('hovering the confirmation keeps it usable and confirming calls the existing native compaction flow', async () => {
  const user = userEvent.setup()
  render(<ContextUsageIndicator />)
  await user.hover(screen.getByRole('button', { name: '上下文用量' }))
  const details = await screen.findByRole('dialog', { name: '上下文用量' })
  await user.click(within(details).getByRole('button', { name: '压缩上下文' }))
  const confirmation = await screen.findByRole('dialog', { name: '压缩当前会话？' })
  await user.hover(confirmation)
  await user.click(within(confirmation).getByRole('button', { name: '确认压缩' }))
  expect(compactPi).toHaveBeenCalledExactlyOnceWith('runtime', expect.any(String), '')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'running',
    activity: '正在压缩上下文…',
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test.each([
  ['running', { status: 'running' }],
  ['read-only', { readOnly: 'History is read-only' }],
  ['settings update', { settingsPending: 'model' }],
  ['empty', { messages: [] }],
  ['disconnected', { instanceId: null, status: 'disconnected' }],
] satisfies Array<[string, Partial<ConversationData>]>)(
  'compaction is disabled for a %s session',
  async (_name, changes) => {
    useConversationStore.setState(changes)
    const user = userEvent.setup()
    render(<ContextUsageIndicator />)
    await user.click(screen.getByRole('button', { name: '上下文用量' }))
    const details = screen.getByRole('dialog', { name: '上下文用量' })
    expect(within(details).getByRole('button', { name: '压缩上下文' })).toBeDisabled()
    expect(compactPi).not.toHaveBeenCalled()
  },
)

test('an already open confirmation cannot compact after another operation starts', async () => {
  const user = userEvent.setup()
  render(<ContextUsageIndicator />)
  await user.click(screen.getByRole('button', { name: '上下文用量' }))
  await user.click(screen.getByRole('button', { name: '压缩上下文' }))
  const confirmation = screen.getByRole('dialog', { name: '压缩当前会话？' })
  act(() => useConversationStore.setState({ status: 'running' }))
  const confirm = within(confirmation).getByRole('button', { name: '确认压缩' })
  expect(confirm).toBeDisabled()
  await user.click(confirm)
  expect(compactPi).not.toHaveBeenCalled()
})

test('changing the runtime closes confirmation before it can operate on the next runtime', async () => {
  const user = userEvent.setup()
  render(<ContextUsageIndicator />)
  await user.click(screen.getByRole('button', { name: '上下文用量' }))
  await user.click(screen.getByRole('button', { name: '压缩上下文' }))
  expect(screen.getByRole('dialog', { name: '压缩当前会话？' })).toBeInTheDocument()
  act(() => useConversationStore.setState({ instanceId: 'other-runtime' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(compactPi).not.toHaveBeenCalled()
})
