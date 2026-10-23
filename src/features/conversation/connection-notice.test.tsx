import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { ConnectionNotice } from './connection-notice'
import { useConversationStore } from './store'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))

afterEach(() => {
  vi.useRealTimers()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
})

test.each(['new', 'uncached', 'cached'] as const)(
  '%s conversations stay free of connection notices even when preparation takes longer',
  (kind) => {
    vi.useFakeTimers()
    useConversationStore.setState({
      status: 'connecting',
      sessionFile: kind === 'new' ? null : 'history.jsonl',
      connectionTarget: { projectPath: null, sessionPath: kind === 'new' ? null : 'history.jsonl' },
      connectionStartedAt: Date.now(),
      messages:
        kind === 'cached'
          ? [
              {
                id: 'reply',
                role: 'assistant',
                text: '已有回复',
                thinking: '',
                status: 'complete',
                error: null,
              },
            ]
          : [],
    })
    render(<ConnectionNotice />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(30_000))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  },
)

test('initial startup has no disconnected notice before a conversation is requested', () => {
  render(<ConnectionNotice />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test.each([null, 'history.jsonl'])(
  'failed conversations keep a retry action for session %s and hide it while retrying',
  async (sessionFile) => {
    const connect = vi.fn().mockImplementation(async () => {
      useConversationStore.setState({ status: 'connecting' })
    })
    useWorkspaceStore.setState({ projectPath: 'D:/project' })
    useConversationStore.setState({
      status: 'disconnected',
      sessionFile,
      connectionTarget: { projectPath: 'D:/project', sessionPath: sessionFile },
      error: '助手启动失败',
      connect,
    })
    const user = userEvent.setup()
    render(<ConnectionNotice />)
    expect(screen.getByRole('status')).toHaveTextContent('连接未完成')
    await user.click(screen.getByRole('button', { name: '重新连接' }))
    expect(connect).toHaveBeenCalledExactlyOnceWith('D:/project', sessionFile)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  },
)

test('a disconnected empty conversation still offers recovery without an error', () => {
  useConversationStore.setState({
    connectionTarget: { projectPath: null, sessionPath: null },
  })
  render(<ConnectionNotice />)
  expect(screen.getByRole('status')).toHaveTextContent('助手已断开')
  expect(screen.getByRole('button', { name: '重新连接' })).toBeEnabled()
})

test.each(['ready', 'running', 'stopping'] as const)(
  '%s conversations never show disconnected recovery',
  (status) => {
    useConversationStore.setState({ status, sessionFile: 'history.jsonl', error: '之前的错误' })
    render(<ConnectionNotice />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  },
)
