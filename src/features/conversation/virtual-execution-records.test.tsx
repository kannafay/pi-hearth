import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { ConversationLocalState } from './conversation-local-state'
import { ExecutionProcess } from './execution-process'
import type { ProcessItem } from './conversation-turns'
import { VirtualExecutionRecords } from './virtual-execution-records'

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute('role') === 'log' ? 600 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute('role') === 'log' ? 600 : 33
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const viewport = this.closest<HTMLElement>('[role="log"]')
    const top =
      this.getAttribute('role') === 'log'
        ? 0
        : 160 - (viewport?.scrollTop ?? 0) + Number.parseFloat(this.style.top || '0')
    return new DOMRect(0, top, 900, this.getAttribute('role') === 'log' ? 600 : 33)
  })
})

function fixture(count: number, local = new Map<string, unknown>()) {
  const items: ProcessItem[] = Array.from({ length: count }, (_, i) => ({
    kind: 'thinking',
    id: `thought-${i}`,
    text: `第 ${i} 项完整思考内容。`,
    streaming: false,
  }))
  const content = (
    <ConversationLocalState initial={local}>
      <div role="log" aria-label="对话消息" tabIndex={-1} style={{ height: 600, overflow: 'auto' }}>
        <ExecutionProcess stateKey="large-archive" items={items} active={false} />
      </div>
    </ConversationLocalState>
  )
  return { content, local }
}

test.each([100, 1000])(
  'opening %s records mounts only the visible rows and scrolling reveals distant records',
  async (count) => {
    const user = userEvent.setup()
    render(fixture(count).content)
    await user.click(screen.getByRole('button', { name: '执行过程' }))
    const list = screen.getByRole('region', { name: '执行过程详情' })
    await waitFor(() =>
      expect(list.querySelector('[data-process-item="thought-0"]')).toBeInTheDocument(),
    )
    expect(list.querySelectorAll('[data-process-item]').length).toBeLessThan(32)
    expect(list.querySelector(`[data-process-item="thought-${count - 1}"]`)).not.toBeInTheDocument()
    expect(list.querySelector('[data-scroll-area]')).not.toBeInTheDocument()

    const viewport = screen.getByRole('log')
    fireEvent.blur(screen.getByRole('button', { name: '执行过程' }), { relatedTarget: viewport })
    fireEvent.scroll(viewport, { target: { scrollTop: 160 + (count - 15) * 37 } })
    await waitFor(() =>
      expect(list.querySelector(`[data-process-item="thought-${count - 1}"]`)).toBeInTheDocument(),
    )
    expect(list.querySelectorAll('[data-process-item]').length).toBeLessThan(32)
  },
)

test('opening and reopening an archive preserves the shared conversation scroll offset', async () => {
  const user = userEvent.setup()
  render(fixture(1000).content)
  const viewport = screen.getByRole('log')
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    viewport.scrollTop = options.top ?? viewport.scrollTop
  })
  Object.defineProperty(viewport, 'scrollTo', { value: scrollTo })
  const process = screen.getByRole('button', { name: '执行过程' })

  for (const offset of [1200, 2400]) {
    fireEvent.scroll(viewport, { target: { scrollTop: offset } })
    scrollTo.mockClear()
    await user.click(process)
    expect(screen.getByRole('region', { name: '执行过程详情' })).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalled()
    expect(viewport.scrollTop).toBe(offset)
    expect(scrollTo.mock.calls.every(([options]) => options.top === offset)).toBe(true)
    await user.click(process)
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '执行过程详情' })).not.toBeInTheDocument(),
    )
  }
})

test('an expanded record keeps its state when virtualized away and after folding the whole archive', async () => {
  const user = userEvent.setup()
  const { content, local } = fixture(1000)
  render(content)
  const process = screen.getByRole('button', { name: '执行过程' })
  await user.click(process)
  const list = screen.getByRole('region', { name: '执行过程详情' })
  const first = list.querySelector<HTMLElement>('[data-process-item="thought-0"]')!
  const thinking = within(first).getByRole('button', { name: '思考' })
  await user.click(thinking)
  expect(screen.getByText('第 0 项完整思考内容。')).toBeVisible()
  const viewport = screen.getByRole('log')
  fireEvent.scroll(viewport, { target: { scrollTop: 18_500 } })
  expect(thinking).toHaveFocus()
  expect(thinking).toBeInTheDocument()
  act(() => viewport.focus())
  await waitFor(() => expect(thinking).not.toBeInTheDocument())
  fireEvent.scroll(viewport, { target: { scrollTop: 0 } })
  expect(await screen.findByText('第 0 项完整思考内容。')).toBeVisible()
  await user.click(process)
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: '执行过程详情' })).not.toBeInTheDocument(),
  )
  expect(local.get('process:large-archive:measurements')).toBeDefined()
  await user.click(process)
  expect(await screen.findByText('第 0 项完整思考内容。')).toBeVisible()
})

test('large progress notes do not construct a screenful of expensive offscreen messages before measuring', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute('role') === 'log' ? 600 : 2000
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(
      0,
      this.getAttribute('role') === 'log' ? 0 : 160,
      900,
      this.getAttribute('role') === 'log' ? 600 : 2000,
    )
  })
  const items: ProcessItem[] = Array.from({ length: 1000 }, (_, i) => ({
    kind: 'message',
    id: `note-${i}`,
    message: {
      id: `note-${i}`,
      role: 'assistant',
      text: '长说明内容。'.repeat(3000),
      thinking: '',
      status: 'complete',
      error: null,
    },
  }))
  const constructed = new Set<string>()
  render(
    <div role="log">
      <VirtualExecutionRecords items={items}>
        {(item) => {
          constructed.add(item.id)
          return <div>{item.id}</div>
        }}
      </VirtualExecutionRecords>
    </div>,
  )
  expect(constructed.has('note-0')).toBe(true)
  expect(constructed.size).toBeLessThan(8)
})
