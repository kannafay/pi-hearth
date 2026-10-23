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

test('quick new chats finish without flashing a connection notice', () => {
  vi.useFakeTimers()
  useConversationStore.setState({
    status: 'connecting',
    sessionFile: null,
    connectionStartedAt: Date.now(),
  })
  render(<ConnectionNotice />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(499))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  act(() => useConversationStore.setState({ status: 'ready' }))
  expect(vi.getTimerCount()).toBe(0)
  act(() => vi.advanceTimersByTime(8000))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('slower new chats show preparation and keep failures and retry visible', () => {
  vi.useFakeTimers()
  useConversationStore.setState({
    status: 'connecting',
    sessionFile: null,
    connectionStartedAt: Date.now(),
  })
  render(<ConnectionNotice />)
  act(() => vi.advanceTimersByTime(500))
  expect(screen.getByRole('status')).toHaveTextContent('正在准备新会话…')
  expect(screen.getByRole('button', { name: '取消连接' })).toBeEnabled()
  act(() => vi.advanceTimersByTime(7500))
  expect(screen.getByRole('status')).toHaveTextContent('准备时间较长，仍在等待本地助手…')
  act(() => useConversationStore.setState({ status: 'disconnected', error: '准备失败' }))
  expect(screen.getByRole('status')).toHaveTextContent('连接未完成')
  expect(screen.getByRole('button', { name: '重新连接' })).toBeEnabled()
  expect(vi.getTimerCount()).toBe(0)
})

test('switching targets restarts the quiet period and unmounting clears pending notices', () => {
  vi.useFakeTimers()
  useConversationStore.setState({ status: 'connecting', connectionStartedAt: Date.now() })
  const view = render(<ConnectionNotice />)
  act(() => vi.advanceTimersByTime(400))
  act(() => useConversationStore.setState({ connectionStartedAt: Date.now() }))
  act(() => vi.advanceTimersByTime(499))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('status')).toHaveTextContent('正在准备新会话…')
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
