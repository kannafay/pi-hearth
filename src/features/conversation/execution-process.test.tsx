import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ExecutionProcess, formatElapsed } from './execution-process'
import { ConversationLocalState } from './conversation-local-state'

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
      items={[{ kind: 'thinking', id: 'thought', text: '核对信息后给出答复。', streaming: false }]}
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
  const thinking = screen.getByRole('button', { name: '思考' })
  expect(thinking).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('核对信息后给出答复。')).not.toBeInTheDocument()
  await user.click(thinking)
  expect(
    within(screen.getByRole('region', { name: '执行过程详情' })).getByText('核对信息后给出答复。'),
  ).toBeVisible()
  await user.click(trigger)
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: '执行过程详情' })).not.toBeInTheDocument(),
  )
})

test('thinking collapses independently and stays collapsed as more content arrives', async () => {
  const user = userEvent.setup()
  const thought = {
    kind: 'thinking' as const,
    id: 'thought',
    text: '初始思考内容。',
    streaming: true,
  }
  const view = render(<ExecutionProcess stateKey="turn" items={[thought]} active />)
  const process = screen.getByRole('button', { name: '执行过程' })
  const thinking = screen.getByRole('button', { name: '思考' })
  await waitFor(() => expect(thinking).toHaveAttribute('aria-expanded', 'true'))
  expect(screen.getByText(thought.text)).toBeVisible()
  await user.click(thinking)
  expect(thinking).toHaveAttribute('aria-expanded', 'false')
  expect(process).toHaveAttribute('aria-expanded', 'true')
  await waitFor(() => expect(screen.queryByText(thought.text)).not.toBeInTheDocument())
  view.rerender(
    <ExecutionProcess
      stateKey="turn"
      items={[{ ...thought, text: '持续收到的新内容。' }]}
      active
    />,
  )
  expect(thinking).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('持续收到的新内容。')).not.toBeInTheDocument()
  await user.click(thinking)
  expect(screen.getByText('持续收到的新内容。')).toBeVisible()
  await user.keyboard(' ')
  expect(thinking).toHaveAttribute('aria-expanded', 'false')
})

test('new active details animate their first opening without replaying it on a virtual remount', () => {
  vi.useFakeTimers()
  const local = new Map<string, unknown>()
  const content = (
    <ConversationLocalState initial={local}>
      <ExecutionProcess
        stateKey="entry"
        active
        items={[{ kind: 'thinking', id: 'thought', text: '正在思考。', streaming: true }]}
      />
    </ConversationLocalState>
  )
  const view = render(content)
  expect(screen.getByRole('button', { name: '思考' })).toHaveAttribute('aria-expanded', 'false')
  act(() => vi.advanceTimersByTime(32))
  expect(screen.getByRole('button', { name: '思考' })).toHaveAttribute('aria-expanded', 'true')
  view.unmount()
  render(content)
  expect(screen.getByRole('button', { name: '思考' })).toHaveAttribute('aria-expanded', 'true')
})

test('active thinking choices survive virtual remounts and reset when it finishes offscreen', async () => {
  const user = userEvent.setup()
  const local = new Map<string, unknown>()
  const content = (streaming = true) => (
    <ConversationLocalState initial={local}>
      <ExecutionProcess
        stateKey="remounted"
        active
        items={[{ kind: 'thinking', id: 'thought', text: '持续思考。', streaming }]}
      />
    </ConversationLocalState>
  )
  let view = render(content())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '思考' })).toHaveAttribute('aria-expanded', 'true'),
  )
  await user.click(screen.getByRole('button', { name: '思考' }))
  view.unmount()
  view = render(content())
  expect(screen.getByRole('button', { name: '思考' })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: '思考' }))
  view.unmount()
  view = render(content(false))
  expect(screen.getByRole('button', { name: '思考' })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: '思考' }))
  view.unmount()
  render(content(false))
  expect(screen.getByRole('button', { name: '思考' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('持续思考。')).toBeVisible()
})

test('collapsing a pinned thinking header keeps that group in view', async () => {
  const user = userEvent.setup()
  const view = render(
    <div data-scroll-area>
      <ExecutionProcess
        stateKey="pinned"
        active
        items={[
          { kind: 'thinking', id: 'long', text: '第一组的长内容。', streaming: false },
          { kind: 'thinking', id: 'next', text: '下一组内容。', streaming: true },
        ]}
      />
    </div>,
  )
  await user.click(screen.getAllByRole('button', { name: '思考' })[0])
  const header = screen.getAllByRole('button', { name: '思考' })[0]
  const group = header.closest('[data-slot="collapsible"]')!
  const viewport = view.container.querySelector<HTMLElement>('[data-scroll-area]')!
  header.style.position = 'sticky'
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ top: 50 } as DOMRect)
  vi.spyOn(group, 'getBoundingClientRect').mockReturnValue({ top: -450 } as DOMRect)
  viewport.scrollTop = 500
  await user.click(header)
  expect(viewport.scrollTop).toBe(0)
  expect(header).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getAllByRole('button', { name: '思考' })[1]).toHaveAttribute(
    'aria-expanded',
    'true',
  )
})

test('each thinking section keeps its own choice across process reopening and virtual row remounts', async () => {
  const user = userEvent.setup()
  const local = new Map<string, unknown>()
  const items = [
    { kind: 'thinking' as const, id: 'first', text: '第一段思考。', streaming: false },
    { kind: 'thinking' as const, id: 'second', text: '第二段思考。', streaming: false },
  ]
  const content = (stateKey = 'turn') => (
    <ConversationLocalState initial={local}>
      <ExecutionProcess stateKey={stateKey} items={items} active={false} />
    </ConversationLocalState>
  )
  let view = render(content())
  await user.click(screen.getByRole('button', { name: '执行过程' }))
  expect(screen.getAllByRole('button', { name: '思考' })[0]).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await user.click(screen.getAllByRole('button', { name: '思考' })[1])
  expect(screen.getAllByRole('button', { name: '思考' })[1]).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  expect(screen.getByText('第二段思考。')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '执行过程' }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '思考' })).not.toBeInTheDocument(),
  )
  await user.click(screen.getByRole('button', { name: '执行过程' }))
  expect(screen.getAllByRole('button', { name: '思考' })[0]).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  view.unmount()
  view = render(content())
  expect(screen.getAllByRole('button', { name: '思考' })[0]).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  expect(screen.getAllByRole('button', { name: '思考' })[1]).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  view.unmount()
  render(content('another-turn'))
  await user.click(screen.getByRole('button', { name: '执行过程' }))
  expect(screen.getAllByRole('button', { name: '思考' })[0]).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

test('the running process cannot be folded until the whole reply finishes', async () => {
  const user = userEvent.setup()
  const items = [{ kind: 'thinking' as const, id: 'thought', text: '思考内容', streaming: true }]
  const view = render(<ExecutionProcess stateKey="locked" items={items} active />)
  const process = screen.getByRole('button', { name: '执行过程' })
  expect(process).toBeDisabled()
  await user.click(process)
  expect(process).toHaveAttribute('aria-expanded', 'true')
  view.rerender(<ExecutionProcess stateKey="locked" items={items} active={false} />)
  expect(process).toBeEnabled()
  expect(process).toHaveAttribute('aria-expanded', 'false')
  await user.click(process)
  expect(process).toHaveAttribute('aria-expanded', 'true')
  view.rerender(<ExecutionProcess stateKey="locked" items={items} active />)
  expect(process).toBeDisabled()
  view.rerender(<ExecutionProcess stateKey="locked" items={items} active={false} />)
  expect(process).toHaveAttribute('aria-expanded', 'false')
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

test('folded thinking defers paragraph construction and folding the process does not rebuild it', async () => {
  const user = userEvent.setup()
  const split = vi.fn(() => ['较长的思考内容。'])
  render(
    <ExecutionProcess
      active={false}
      items={[
        {
          kind: 'thinking',
          id: 'lazy-thought',
          text: { split } as unknown as string,
          streaming: false,
        },
      ]}
    />,
  )
  const process = screen.getByRole('button', { name: '执行过程' })
  expect(split).not.toHaveBeenCalled()
  await user.click(process)
  expect(split).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '思考' }))
  expect(screen.getByText('较长的思考内容。')).toBeVisible()
  expect(split).toHaveBeenCalledOnce()
  await user.click(process)
  await waitFor(() => expect(screen.queryByText('较长的思考内容。')).not.toBeInTheDocument())
  expect(split).toHaveBeenCalledOnce()
})

test.each([
  [0, '0秒'],
  [21_999, '21秒'],
  [3_661_000, '1小时1分1秒'],
  [-10, '0秒'],
])('formats elapsed milliseconds %s as %s', (milliseconds, label) => {
  expect(formatElapsed(Number(milliseconds))).toBe(label)
})
