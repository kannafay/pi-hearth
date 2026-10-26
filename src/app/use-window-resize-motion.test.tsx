import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { isDesktop } from '@/lib/desktop'
import type { PhysicalSize } from '@tauri-apps/api/dpi'
import { useWindowResizeMotion } from './use-window-resize-motion'

const { innerSize } = vi.hoisted(() => ({ innerSize: vi.fn() }))
vi.mock('@/lib/desktop', () => ({ isDesktop: vi.fn(() => false) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ innerSize }) }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(isDesktop).mockReturnValue(false)
  innerSize.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

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

test.each([1, 1.25, 1.5, 2])(
  'native client bounds compensate one clipped screen pixel at scale %s',
  async (scale) => {
    vi.mocked(isDesktop).mockReturnValue(true)
    vi.stubGlobal('devicePixelRatio', scale)
    vi.stubGlobal('visualViewport', { width: 1002 / scale, height: 802 / scale })
    innerSize.mockResolvedValue({ width: 1001, height: 801 })
    const root = document.documentElement
    const { unmount } = renderHook(useWindowResizeMotion)
    await act(async () => {})
    expect(root.style.getPropertyValue('--window-overflow-width')).toBe(`${1 / scale}px`)
    expect(root.style.getPropertyValue('--window-overflow-height')).toBe(`${1 / scale}px`)
    unmount()
    expect(root.style.getPropertyValue('--window-overflow-width')).toBe('')
    expect(root.style.getPropertyValue('--window-overflow-height')).toBe('')
  },
)

test('aligned native viewports keep their original size and browser previews skip native calls', async () => {
  const preview = renderHook(useWindowResizeMotion)
  expect(innerSize).not.toHaveBeenCalled()
  preview.unmount()
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.stubGlobal('devicePixelRatio', 1.25)
  vi.stubGlobal('visualViewport', { width: 800, height: 600 })
  innerSize.mockResolvedValue({ width: 1000, height: 750 })
  renderHook(useWindowResizeMotion)
  await act(async () => {})
  expect(document.documentElement.style.getPropertyValue('--window-overflow-width')).toBe('0px')
  expect(document.documentElement.style.getPropertyValue('--window-overflow-height')).toBe('0px')
})

test('late size responses cannot replace a newer resize or restore styles after unmount', async () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.stubGlobal('devicePixelRatio', 1.25)
  vi.stubGlobal('visualViewport', { width: 800, height: 600 })
  const pending: Array<(value: Pick<PhysicalSize, 'width' | 'height'>) => void> = []
  innerSize.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
  const root = document.documentElement
  const { unmount } = renderHook(useWindowResizeMotion)
  act(() => window.dispatchEvent(new Event('resize')))
  await act(async () => pending[1]({ width: 999, height: 749 }))
  expect(root.style.getPropertyValue('--window-overflow-width')).toBe('0.8px')
  await act(async () => pending[0]({ width: 1000, height: 750 }))
  expect(root.style.getPropertyValue('--window-overflow-width')).toBe('0.8px')
  act(() => window.dispatchEvent(new Event('resize')))
  unmount()
  await act(async () => pending[2]({ width: 999, height: 749 }))
  expect(root.style.getPropertyValue('--window-overflow-width')).toBe('')
})

test('a failed native size read falls back to the browser viewport', async () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.stubGlobal('devicePixelRatio', 1.25)
  vi.stubGlobal('visualViewport', { width: 800, height: 600 })
  innerSize.mockResolvedValueOnce({ width: 999, height: 749 }).mockRejectedValueOnce('unavailable')
  renderHook(useWindowResizeMotion)
  await act(async () => {})
  expect(document.documentElement.style.getPropertyValue('--window-overflow-width')).toBe('0.8px')
  await act(async () => window.dispatchEvent(new Event('resize')))
  expect(document.documentElement.style.getPropertyValue('--window-overflow-width')).toBe('')
  expect(document.documentElement.style.getPropertyValue('--window-overflow-height')).toBe('')
})
