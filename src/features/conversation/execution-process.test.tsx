import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ExecutionProcess, formatElapsed } from './execution-process'

afterEach(() => vi.useRealTimers())

test('the running clock advances and the finished duration remains fixed', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  const { rerender } = render(<ExecutionProcess items={[]} active startedAt={100_000} />)
  expect(screen.getByText('已用时 0秒')).toBeVisible()
  act(() => vi.advanceTimersByTime(217_000))
  expect(screen.getByText('已用时 3分37秒')).toBeVisible()
  rerender(<ExecutionProcess items={[]} active={false} startedAt={100_000} finishedAt={317_000} />)
  expect(screen.getByText('用时 3分37秒')).toBeVisible()
  act(() => vi.advanceTimersByTime(60_000))
  expect(screen.getByText('用时 3分37秒')).toBeVisible()
})

test('history with no timing data avoids displaying a made-up zero duration', () => {
  render(<ExecutionProcess items={[]} active={false} />)
  expect(screen.getByText('已完成')).toBeVisible()
  expect(screen.queryByText(/用时/)).not.toBeInTheDocument()
})

test.each([0, 1999, 2000])(
  'plain completed replies hide the process header after %s milliseconds',
  (elapsed) => {
    const { container } = render(
      <ExecutionProcess
        items={[]}
        active={false}
        startedAt={100_000}
        finishedAt={100_000 + elapsed}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  },
)

test('a reply over two seconds retains its duration even when the displayed seconds round down', () => {
  render(<ExecutionProcess items={[]} active={false} startedAt={100_000} finishedAt={102_001} />)
  expect(screen.getByText('用时 2秒')).toBeVisible()
})

test('a fast running reply retains the live clock until it completes', () => {
  const startedAt = Date.now()
  const { rerender, container } = render(
    <ExecutionProcess items={[]} active startedAt={startedAt} />,
  )
  expect(screen.getByText('已用时 0秒')).toBeVisible()
  rerender(
    <ExecutionProcess
      items={[]}
      active={false}
      startedAt={startedAt}
      finishedAt={startedAt + 500}
    />,
  )
  expect(container).toBeEmptyDOMElement()
})

test('quick replies with thinking retain the duration and accessible disclosure', async () => {
  const user = userEvent.setup()
  render(
    <ExecutionProcess
      items={[{ kind: 'thinking', id: 'thought', text: '核对信息后给出答复。' }]}
      active={false}
      startedAt={100_000}
      finishedAt={100_500}
    />,
  )
  expect(screen.getByText('用时 0秒')).toBeVisible()
  const trigger = screen.getByRole('button', { name: '执行过程' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(
    within(screen.getByRole('region', { name: '执行过程详情' })).getByText('核对信息后给出答复。'),
  ).toBeVisible()
  await user.click(trigger)
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: '执行过程详情' })).not.toBeInTheDocument(),
  )
})

test('quick replies with tools retain the duration and accessible tool records', async () => {
  const user = userEvent.setup()
  render(
    <ExecutionProcess
      items={[
        {
          kind: 'tool',
          id: 'read-1',
          tool: {
            id: 'read-1',
            toolCallId: 'call-1',
            runId: 'run-1',
            name: 'read',
            summary: 'notes.txt',
            arguments: '{"path":"notes.txt"}',
            argumentsTruncated: false,
            output: '读取完成',
            outputTruncated: false,
            status: 'complete',
            approvalId: null,
            durationMs: 50,
          },
        },
      ]}
      active={false}
      startedAt={100_000}
      finishedAt={100_800}
    />,
  )
  expect(screen.getByText('用时 0秒')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '执行过程' }))
  expect(
    within(screen.getByRole('region', { name: '执行过程详情' })).getByText('notes.txt'),
  ).toBeVisible()
})

test.each([
  [0, '0秒'],
  [21_999, '21秒'],
  [3_661_000, '1小时1分1秒'],
  [-10, '0秒'],
])('formats elapsed milliseconds %s as %s', (milliseconds, label) => {
  expect(formatElapsed(Number(milliseconds))).toBe(label)
})
