import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { ConversationPanel } from './conversation-panel'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from './store'
import type { ChatMessage, PiEvent, ToolCall } from '@/lib/generated/pi'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))
vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}))
vi.mock('@streamdown/code', () => ({ code: {} }))

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useWorkspaceStore.setState({ projectPath: 'D:\\项目', draft: '' })
})

test('sent attachments sit outside and before the text bubble and still open previews', async () => {
  const image = {
    id: 'image',
    name: 'picture.png',
    kind: 'image',
    mimeType: 'image/png',
    size: 1024,
    preview: 'data:image/png;base64,AAAA',
  }
  useConversationStore.setState({
    messages: [
      {
        id: 'user',
        role: 'user',
        text: '请查看附件。',
        thinking: '',
        status: 'complete',
        error: null,
        attachments: [image],
      },
    ],
  })
  const user = userEvent.setup()
  render(<ConversationPanel />)
  const message = screen.getByRole('article', { name: '你的消息' })
  const preview = within(message).getByRole('button', { name: '查看图片' })
  const bubble = within(message).getByText('请查看附件。').closest('.user-message-bubble')!
  expect(bubble).not.toContainElement(preview)
  expect(preview.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await user.click(preview)
  expect(useWorkspaceStore.getState().attachmentPreview).toEqual(image)
})

test('an attachment-only message has a clickable file without an empty text bubble', async () => {
  const file = {
    id: 'file',
    name: 'notes.txt',
    kind: 'text',
    mimeType: 'text/plain',
    size: 48,
    preview: null,
    text: '附件内容',
  }
  useConversationStore.setState({
    messages: [
      {
        id: 'user',
        role: 'user',
        text: '',
        thinking: '',
        status: 'complete',
        error: null,
        attachments: [file],
      },
    ],
  })
  const user = userEvent.setup()
  render(<ConversationPanel />)
  const message = screen.getByRole('article', { name: '你的消息' })
  expect(message.querySelector('.user-message-bubble')).toBeNull()
  await user.click(within(message).getByRole('button', { name: '查看 notes.txt' }))
  expect(useWorkspaceStore.getState().attachmentPreview).toEqual(file)
})

test('Enter sends, Shift+Enter adds a line, and the draft clears only after acceptance', async () => {
  const send = vi.fn().mockResolvedValue(true)
  useConversationStore.setState({ status: 'ready', send })
  const user = userEvent.setup()
  render(<ConversationPanel />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.type(input, '第一行{Shift>}{Enter}{/Shift}第二行')
  expect(send).not.toHaveBeenCalled()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(send).toHaveBeenCalledWith('第一行\n第二行', []))
  expect(input).toHaveValue('')
})

test('rejected input remains available for retry and running replaces send with stop', async () => {
  useConversationStore.setState({ status: 'ready', send: vi.fn().mockResolvedValue(false) })
  const user = userEvent.setup()
  const view = render(<ConversationPanel />)
  await user.type(screen.getByRole('textbox', { name: '消息草稿' }), '保留这条消息')
  await user.click(screen.getByRole('button', { name: '发送消息' }))
  expect(screen.getByRole('textbox', { name: '消息草稿' })).toHaveValue('保留这条消息')
  useConversationStore.setState({
    status: 'running',
    activeRunId: 'run-1',
    messages: [
      {
        id: 'run-1-user',
        role: 'user',
        text: '保留这条消息',
        thinking: '',
        status: 'complete',
        error: null,
      },
    ],
  })
  view.rerender(<ConversationPanel />)
  expect(screen.getByRole('button', { name: '停止生成' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '发送消息' })).not.toBeInTheDocument()
})

test('a confirmed stop is displayed as cancellation rather than a provider error', () => {
  useConversationStore.setState({
    status: 'ready',
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        text: '部分回复',
        thinking: '',
        status: 'cancelled',
        error: 'Request was aborted',
      },
    ],
  })
  render(<ConversationPanel />)
  expect(screen.getByText('部分回复')).toBeVisible()
  expect(
    within(screen.getByRole('article', { name: 'Pi 的回复' })).getByText('已停止生成'),
  ).toBeVisible()
  expect(screen.queryByText('Request was aborted')).not.toBeInTheDocument()
})

function processFixture() {
  const user: ChatMessage = {
    id: 'run-1-user',
    role: 'user',
    text: '分析文件',
    thinking: '',
    status: 'complete',
    error: null,
  }
  const progress: ChatMessage = {
    id: 'progress',
    role: 'assistant',
    text: '先读取文件。',
    thinking: '检查所需信息',
    status: 'complete',
    error: null,
  }
  const answer: ChatMessage = {
    id: 'answer',
    role: 'assistant',
    text: '最终分析结果',
    thinking: '整理结论',
    status: 'complete',
    error: null,
  }
  const tool: ToolCall = {
    id: 'tool-1',
    toolCallId: 'source-1',
    runId: 'run-1',
    name: 'read',
    summary: 'notes.txt',
    arguments: '{"path":"notes.txt"}',
    argumentsTruncated: false,
    output: '第一段输出',
    outputTruncated: false,
    status: 'running',
    approvalId: null,
    durationMs: null,
  }
  const timeline = [
    { kind: 'message', id: user.id },
    { kind: 'message', id: progress.id },
    { kind: 'tool', id: tool.id },
  ]
  return { user, progress, answer, tool, timeline }
}

function receive(sequence: number, data: PiEvent['data']) {
  act(() =>
    useConversationStore.getState().receive([
      {
        instanceId: 'pi-1',
        projectPath: 'D:/项目',
        sessionId: 'session',
        runId: 'run-1',
        sequence,
        data,
      },
    ]),
  )
}

test('completed history shows one final reply and keeps all process details in a collapsed group', async () => {
  const { user: prompt, progress, answer, tool, timeline } = processFixture()
  useConversationStore.setState({
    status: 'ready',
    messages: [prompt, progress, answer],
    tools: [{ ...tool, status: 'complete' }],
    timeline: [...timeline, { kind: 'message', id: answer.id }],
  })
  const user = userEvent.setup()
  render(<ConversationPanel />)
  expect(screen.getAllByRole('article', { name: 'Pi 的回复' })).toHaveLength(1)
  expect(screen.getByText(answer.text)).toBeVisible()
  expect(screen.queryByText(progress.text)).not.toBeInTheDocument()
  expect(screen.queryByText(progress.thinking)).not.toBeInTheDocument()
  const trigger = screen.getByRole('button', { name: '执行过程' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.click(trigger)
  const process = await screen.findByRole('region', { name: '执行过程详情' })
  expect(within(process).getByText(progress.text)).toBeVisible()
  expect(within(process).getByText(answer.thinking)).toBeVisible()
  expect(within(process).queryByText(answer.text)).not.toBeInTheDocument()
  await user.click(within(process).getByRole('button', { name: /读取文件/ }))
  expect(within(process).getByText(tool.output)).toBeVisible()
})

test('live tool output and final-answer deltas render immediately, then the process automatically collapses', async () => {
  const { user: prompt, progress, answer, tool, timeline } = processFixture()
  useConversationStore.setState({
    instanceId: 'pi-1',
    status: 'running',
    activeRunId: 'run-1',
    messages: [prompt, progress],
    tools: [tool],
    timeline,
  })
  const user = userEvent.setup()
  render(<ConversationPanel />)
  const trigger = screen.getByRole('button', { name: '执行过程' })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const process = screen.getByRole('region', { name: '执行过程详情' })
  await user.click(within(process).getByRole('button', { name: /读取文件/ }))
  receive(1, { type: 'tool_changed', tool: { ...tool, output: '第一段输出\n第二段输出' } })
  expect(within(process).getByText(/第二段输出/)).toBeVisible()
  receive(2, {
    type: 'message_started',
    message: { ...answer, text: '', thinking: '', status: 'streaming' },
  })
  receive(3, {
    type: 'message_delta',
    messageId: answer.id,
    contentIndex: 0,
    kind: 'text',
    delta: '实时答复',
  })
  expect(screen.getByText('实时答复')).toBeVisible()
  expect(within(process).queryByText('实时答复')).not.toBeInTheDocument()
  receive(4, {
    type: 'message_delta',
    messageId: answer.id,
    contentIndex: 0,
    kind: 'text',
    delta: '继续输出',
  })
  expect(screen.getByText('实时答复继续输出')).toBeVisible()
  receive(5, { type: 'message_completed', message: { ...answer, text: '实时答复继续输出' } })
  receive(6, { type: 'run_finished', status: 'complete', error: null })
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  expect(screen.queryByRole('region', { name: '执行过程详情' })).not.toBeInTheDocument()
  expect(screen.getByText('实时答复继续输出')).toBeVisible()
})

test('approval requests force a manually collapsed process open and cancellation remains visible', async () => {
  const { user: prompt, progress, tool, timeline } = processFixture()
  useConversationStore.setState({
    instanceId: 'pi-1',
    status: 'running',
    activeRunId: 'run-1',
    messages: [prompt, progress],
    tools: [tool],
    timeline,
  })
  const user = userEvent.setup()
  render(<ConversationPanel />)
  const trigger = screen.getByRole('button', { name: '执行过程' })
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  receive(1, {
    type: 'tool_changed',
    tool: { ...tool, status: 'awaiting_approval', approvalId: 'approval-1' },
  })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: '允许本次' })).toBeVisible()
  expect(screen.getByText(tool.arguments)).toBeVisible()
  receive(2, { type: 'run_finished', status: 'cancelled', error: null })
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  expect(screen.queryByRole('button', { name: '允许本次' })).not.toBeInTheDocument()
  expect(
    within(screen.getByRole('article', { name: 'Pi 的回复' })).getByText('已停止生成'),
  ).toBeVisible()
})

test('starting the next request does not re-expand the previous turn before its user event arrives', () => {
  const { user: prompt, progress, answer, tool, timeline } = processFixture()
  useConversationStore.setState({
    status: 'ready',
    messages: [prompt, progress, answer],
    tools: [{ ...tool, status: 'complete' }],
    timeline: [...timeline, { kind: 'message', id: answer.id }],
  })
  render(<ConversationPanel />)
  act(() => useConversationStore.setState({ status: 'running', activeRunId: 'next-run' }))
  expect(screen.getByRole('button', { name: '执行过程' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByText(answer.text)).toBeVisible()
})

test('an uncached conversation uses a compact loading notice and a skeleton while drafts remain editable', async () => {
  const disconnect = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({
    status: 'connecting',
    sessionFile: 'history.jsonl',
    connectionStartedAt: Date.now(),
    disconnect,
  })
  const user = userEvent.setup()
  render(<ConversationPanel />)
  expect(screen.getByRole('status')).toHaveTextContent('正在载入会话…')
  expect(screen.queryByRole('heading', { name: '正在打开会话' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: '消息草稿' }), '先写草稿')
  expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '取消连接' }))
  expect(disconnect).toHaveBeenCalledOnce()
  expect(useWorkspaceStore.getState().draft).toBe('先写草稿')
})

test('cached history stays visible during connection and failures have an inline retry action', async () => {
  const { answer } = processFixture()
  const connect = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({
    status: 'connecting',
    sessionFile: 'history.jsonl',
    messages: [answer],
    connect,
  })
  const user = userEvent.setup()
  render(<ConversationPanel />)
  expect(screen.getByText(answer.text)).toBeVisible()
  expect(screen.queryByLabelText('正在载入会话')).not.toBeInTheDocument()
  const notice = screen.getByRole('status')
  expect(notice).toHaveTextContent('正在连接助手…')
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  expect(input.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  act(() => useConversationStore.setState({ status: 'disconnected', error: '助手启动失败' }))
  expect(screen.getByText(answer.text)).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('助手启动失败')
  await user.click(screen.getByRole('button', { name: '重新连接' }))
  expect(connect).toHaveBeenCalledWith('D:\\项目', 'history.jsonl')
})
