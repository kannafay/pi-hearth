import { act, fireEvent, render, screen } from '@testing-library/react'
import { Brain } from 'lucide-react'
import { afterEach, expect, test, vi } from 'vitest'
import { ExecutionRecord } from './execution-record'

afterEach(() => vi.useRealTimers())

test('live details follow new output, pause while reading above, and resume at the end', () => {
  vi.useFakeTimers()
  const content = (text: string) => (
    <ExecutionRecord
      icon={Brain}
      title="思考"
      open
      follow
      onOpenChange={() => {}}
      headerRef={{ current: null }}
    >
      {text}
    </ExecutionRecord>
  )
  const view = render(content('第一段思考'))
  const viewport = screen.getByRole('region', { name: '思考详情' })
  Object.defineProperties(viewport, {
    clientHeight: { value: 320 },
    scrollHeight: { value: 1000 },
  })
  act(() => vi.advanceTimersByTime(32))
  expect(viewport.scrollTop).toBe(1000)

  fireEvent.scroll(viewport, { target: { scrollTop: 300 } })
  view.rerender(content('新增内容，但用户正在向上阅读'))
  act(() => vi.advanceTimersByTime(32))
  expect(viewport.scrollTop).toBe(300)

  fireEvent.scroll(viewport, { target: { scrollTop: 680 } })
  view.rerender(content('用户回到底部，继续跟随新增内容'))
  act(() => vi.advanceTimersByTime(32))
  expect(viewport.scrollTop).toBe(1000)
})

test('a new approval scrolls to its buttons after the reader paused above, then permits reading', () => {
  vi.useFakeTimers()
  const content = (approval: boolean, text: string) => (
    <ExecutionRecord
      icon={Brain}
      title="执行命令"
      open
      follow
      revealEnd={approval}
      onOpenChange={() => {}}
      headerRef={{ current: null }}
    >
      <pre>{text}</pre>
      {approval && <button>允许本次</button>}
    </ExecutionRecord>
  )
  const view = render(content(false, '长输出'))
  const viewport = screen.getByRole('region', { name: '执行命令详情' })
  Object.defineProperties(viewport, {
    clientHeight: { value: 304 },
    scrollHeight: { value: 1800 },
  })
  act(() => vi.advanceTimersByTime(32))
  fireEvent.scroll(viewport, { target: { scrollTop: 200 } })
  view.rerender(content(true, '等待确认的完整参数'))
  act(() => vi.advanceTimersByTime(32))
  expect(viewport.scrollTop).toBe(1800)
  expect(screen.getByRole('button', { name: '允许本次' })).toBeInTheDocument()
  fireEvent.scroll(viewport, { target: { scrollTop: 100 } })
  view.rerender(content(true, '读取更多参数'))
  act(() => vi.advanceTimersByTime(32))
  expect(viewport.scrollTop).toBe(100)
})

test('late layout changes follow the content size without a React update and stop after unmount', () => {
  vi.useFakeTimers()
  let resized: ResizeObserverCallback | undefined
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
  try {
    const view = render(
      <ExecutionRecord
        icon={Brain}
        title="思考"
        open
        follow
        onOpenChange={() => {}}
        headerRef={{ current: null }}
      >
        长内容
      </ExecutionRecord>,
    )
    const viewport = screen.getByRole('region', { name: '思考详情' })
    let height = 1000
    Object.defineProperties(viewport, {
      clientHeight: { value: 304 },
      scrollHeight: { get: () => height },
    })
    act(() => vi.advanceTimersByTime(32))
    expect(viewport.scrollTop).toBe(1000)
    height = 2000
    act(() => {
      resized!([], {} as ResizeObserver)
      vi.advanceTimersByTime(32)
    })
    expect(viewport.scrollTop).toBe(2000)
    view.unmount()
    expect(disconnect).toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
