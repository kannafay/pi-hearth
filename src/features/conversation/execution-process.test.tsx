import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ExecutionProcess, formatElapsed } from './execution-process'

afterEach(() => vi.useRealTimers())

test('the running clock advances and the finished duration remains fixed', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  const { rerender } = render(<ExecutionProcess items={[]} active startedAt={100_000} />)
  expect(screen.getByText('已处理 0秒')).toBeVisible()
  act(() => vi.advanceTimersByTime(217_000))
  expect(screen.getByText('已处理 3分37秒')).toBeVisible()
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

test.each([
  [0, '0秒'],
  [21_999, '21秒'],
  [3_661_000, '1小时1分1秒'],
  [-10, '0秒'],
])('formats elapsed milliseconds %s as %s', (milliseconds, label) => {
  expect(formatElapsed(Number(milliseconds))).toBe(label)
})
