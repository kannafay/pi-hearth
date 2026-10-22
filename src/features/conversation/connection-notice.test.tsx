import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ConnectionNotice } from './connection-notice'
import { useConversationStore } from './store'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))

afterEach(() => {
  vi.useRealTimers()
  useConversationStore.setState(useConversationStore.getInitialState(), true)
})

test('slow connections get a clear waiting message and switching targets resets the delay', () => {
  vi.useFakeTimers()
  const startedAt = Date.now()
  useConversationStore.setState({
    status: 'connecting',
    sessionFile: 'A',
    connectionStartedAt: startedAt,
  })
  render(<ConnectionNotice />)
  act(() => vi.advanceTimersByTime(7999))
  expect(screen.getByRole('status')).toHaveTextContent('正在载入会话…')
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('status')).toHaveTextContent('连接较慢，仍在等待本地助手…')
  act(() => useConversationStore.setState({ sessionFile: 'B', connectionStartedAt: Date.now() }))
  expect(screen.getByRole('status')).toHaveTextContent('正在载入会话…')
  act(() => useConversationStore.setState({ status: 'ready' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(vi.getTimerCount()).toBe(0)
})
