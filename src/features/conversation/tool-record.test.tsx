import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import type { ToolCall } from '@/lib/generated/pi'
import { decidePiTool, loadPiToolOutput } from '@/lib/pi'
import { useConversationStore } from './store'
import { ToolRecord } from './tool-record'

vi.mock('@/lib/pi', () => ({ decidePiTool: vi.fn(), loadPiToolOutput: vi.fn() }))
const tool: ToolCall = {
  id: 'tool-1',
  toolCallId: 'source-1',
  runId: 'run-1',
  name: 'write',
  summary: 'test.txt',
  arguments: '{"path":"test.txt","content":"hello"}',
  argumentsTruncated: false,
  output: '',
  outputTruncated: false,
  status: 'awaiting_approval',
  approvalId: 'approve-1',
  durationMs: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ instanceId: 'pi-1', activeRunId: 'run-1', status: 'running' })
})

test('approval shows parameters and allows exactly one decision before the ordered event', async () => {
  vi.mocked(decidePiTool).mockResolvedValue()
  const user = userEvent.setup()
  const view = render(<ToolRecord tool={tool} />)
  expect(await screen.findByText(tool.arguments)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '允许本次' }))
  expect(decidePiTool).toHaveBeenCalledExactlyOnceWith('pi-1', 'approve-1', true)
  expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled()
  view.rerender(
    <ToolRecord tool={{ ...tool, status: 'complete', approvalId: null, output: '成功写入' }} />,
  )
  expect(screen.queryByRole('button', { name: '允许本次' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /写入文件/ })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: /写入文件/ }))
  expect(screen.getByText('成功写入')).toBeVisible()
})

test('truncated arguments must be fully loaded before approval; refusal is always available', async () => {
  vi.mocked(loadPiToolOutput).mockResolvedValue({
    content: '完整参数',
    nextOffset: null,
    totalBytes: 12,
  })
  vi.mocked(decidePiTool).mockResolvedValue()
  const user = userEvent.setup()
  render(<ToolRecord tool={{ ...tool, argumentsTruncated: true }} />)
  expect(await screen.findByRole('button', { name: '允许本次' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '拒绝' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '加载完整参数' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '允许本次' })).toBeEnabled())
  expect(screen.getByText('完整参数')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '拒绝' }))
  expect(decidePiTool).toHaveBeenCalledExactlyOnceWith('pi-1', 'approve-1', false)
})

test('expanded command output updates live and displays errors as plain text', async () => {
  const user = userEvent.setup()
  const view = render(
    <ToolRecord tool={{ ...tool, name: 'powershell', status: 'running', output: 'first' }} />,
  )
  expect(await screen.findByRole('button', { expanded: true })).toBeVisible()
  expect(screen.getByText('实时输出')).toBeVisible()
  view.rerender(
    <ToolRecord
      tool={{
        ...tool,
        name: 'powershell',
        status: 'failed',
        output: '<script>failure</script>',
        approvalId: null,
      }}
    />,
  )
  expect(screen.getByRole('button', { name: /执行命令/ })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: /执行命令/ }))
  expect(screen.getByText('<script>failure</script>')).toBeVisible()
  expect(screen.getByText('执行失败')).toBeVisible()
  expect(screen.queryByText('first')).not.toBeInTheDocument()
})

test('a running step manually folded by the reader reopens when approval is requested', async () => {
  const user = userEvent.setup()
  const view = render(<ToolRecord tool={{ ...tool, status: 'running', approvalId: null }} />)
  const header = await screen.findByRole('button', { expanded: true })
  await user.click(header)
  expect(header).toHaveAttribute('aria-expanded', 'false')
  view.rerender(<ToolRecord tool={tool} />)
  expect(await screen.findByRole('button', { name: '允许本次' })).toBeVisible()
  expect(header).toHaveAttribute('aria-expanded', 'true')
  expect(header).toBeDisabled()
})

test.each(['complete', 'failed', 'denied', 'cancelled', 'interrupted'])(
  'tool details follow the queued and running phases, then collapse on %s',
  async (terminalStatus) => {
    const user = userEvent.setup()
    const queued = { ...tool, status: 'queued', approvalId: null }
    const view = render(<ToolRecord tool={queued} />)
    const header = screen.getByRole('button', { name: /写入文件/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    await user.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')

    const running = { ...queued, status: 'running', output: '正在写入' }
    view.rerender(<ToolRecord tool={running} />)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    await user.click(header)
    view.rerender(<ToolRecord tool={{ ...running, output: '持续写入' }} />)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    await user.click(header)
    expect(screen.getByText('持续写入')).toBeVisible()

    view.rerender(
      <ToolRecord tool={{ ...running, status: terminalStatus, output: '操作已结束' }} />,
    )
    expect(header).toHaveAttribute('aria-expanded', 'false')
    await user.click(header)
    expect(screen.getByText('操作已结束')).toBeVisible()
  },
)

test('cached tool details load from the fresh runtime tool ID after a session restore', async () => {
  useConversationStore.setState({
    instanceId: 'new-runtime',
    status: 'ready',
    activeRunId: null,
    runtimeToolIds: { [tool.id]: 'new-tool' },
  })
  vi.mocked(loadPiToolOutput).mockResolvedValue({
    content: '完整历史输出',
    nextOffset: null,
    totalBytes: 20,
  })
  const user = userEvent.setup()
  render(
    <ToolRecord
      tool={{
        ...tool,
        status: 'complete',
        approvalId: null,
        output: '输出末尾',
        outputTruncated: true,
      }}
    />,
  )
  await user.click(screen.getByRole('button', { expanded: false }))
  await user.click(screen.getByRole('button', { name: '加载完整输出' }))
  expect(await screen.findByText('完整历史输出')).toBeVisible()
  expect(loadPiToolOutput).toHaveBeenCalledExactlyOnceWith('new-runtime', 'new-tool', 'output', 0)
})

test('an unchanged tool record still follows a runtime reconnect before loading details', async () => {
  const user = userEvent.setup()
  vi.mocked(loadPiToolOutput).mockResolvedValue({
    content: '重连后加载的完整输出',
    nextOffset: null,
    totalBytes: 30,
  })
  render(
    <ToolRecord
      tool={{
        ...tool,
        status: 'complete',
        approvalId: null,
        output: '末尾',
        outputTruncated: true,
      }}
    />,
  )
  act(() => useConversationStore.setState({ instanceId: 'reconnected-runtime' }))
  await user.click(screen.getByRole('button', { expanded: false }))
  await user.click(screen.getByRole('button', { name: '加载完整输出' }))
  expect(await screen.findByText('重连后加载的完整输出')).toBeVisible()
  expect(loadPiToolOutput).toHaveBeenCalledExactlyOnceWith(
    'reconnected-runtime',
    tool.id,
    'output',
    0,
  )
})
