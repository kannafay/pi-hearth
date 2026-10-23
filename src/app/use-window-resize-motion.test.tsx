import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useWindowResizeMotion } from './use-window-resize-motion'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('window resizing disables layout motion immediately until the last resize settles', () => {
  const { unmount } = renderHook(useWindowResizeMotion)
  const root = document.documentElement
  expect(root).not.toHaveAttribute('data-window-resizing')

  act(() => window.dispatchEvent(new Event('resize')))
  expect(root).toHaveAttribute('data-window-resizing')
  act(() => vi.advanceTimersByTime(150))
  act(() => window.dispatchEvent(new Event('resize')))
  act(() => vi.advanceTimersByTime(150))
  expect(root).toHaveAttribute('data-window-resizing')
  act(() => vi.advanceTimersByTime(50))
  expect(root).not.toHaveAttribute('data-window-resizing')
  unmount()
})

test('unmounting clears the resize guard, its timer and its window listener', () => {
  const { unmount } = renderHook(useWindowResizeMotion)
  act(() => window.dispatchEvent(new Event('resize')))
  unmount()
  expect(document.documentElement).not.toHaveAttribute('data-window-resizing')
  expect(vi.getTimerCount()).toBe(0)
  act(() => window.dispatchEvent(new Event('resize')))
  expect(document.documentElement).not.toHaveAttribute('data-window-resizing')
})
