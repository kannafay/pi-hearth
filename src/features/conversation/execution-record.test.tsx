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
