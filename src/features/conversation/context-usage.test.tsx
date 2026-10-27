import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test } from 'vitest'
import { ContextUsageIndicator } from './context-usage'
import { useConversationStore } from './store'

beforeEach(() => {
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ status: 'ready', sessionId: 'current' })
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
