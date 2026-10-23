import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { isDesktop } from './desktop'
import { observeSystemTheme } from './system-theme'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('./desktop', () => ({ isDesktop: vi.fn() }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

test('Windows observes OS changes independently of the webview color preference', async () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Windows NT 10.0')
  const media = vi.spyOn(window, 'matchMedia')
  const stop = vi.fn()
  vi.mocked(listen).mockResolvedValue(stop)
  vi.mocked(invoke).mockResolvedValue(true)
  const changed = vi.fn()
  const unlisten = await observeSystemTheme(changed)
  expect(changed).toHaveBeenCalledExactlyOnceWith(true)
  expect(invoke).toHaveBeenCalledExactlyOnceWith('get_system_theme')
  expect(listen).toHaveBeenCalledWith('system-theme-changed', expect.any(Function))
  expect(media).not.toHaveBeenCalled()
  unlisten()
  expect(stop).toHaveBeenCalledOnce()
})

test('a newer OS notification takes precedence over a pending initial read', async () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Windows NT 10.0')
  vi.mocked(listen).mockResolvedValue(vi.fn())
  let finish!: (dark: boolean) => void
  vi.mocked(invoke).mockReturnValue(new Promise((resolve) => (finish = resolve)))
  const changed = vi.fn()
  const pending = observeSystemTheme(changed)
  await Promise.resolve()
  vi.mocked(listen).mock.calls[0][1]({ event: 'system-theme-changed', id: 1, payload: true })
  finish(false)
  await pending
  expect(changed.mock.calls).toEqual([[true]])
})

test('failed native initialization removes its event listener', async () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Windows NT 10.0')
  const stop = vi.fn()
  vi.mocked(listen).mockResolvedValue(stop)
  vi.mocked(invoke).mockRejectedValue(new Error('读取失败'))
  await expect(observeSystemTheme(vi.fn())).rejects.toThrow('读取失败')
  expect(stop).toHaveBeenCalledOnce()
})

test('browser themes follow media changes and remove their listener', async () => {
  vi.mocked(isDesktop).mockReturnValue(false)
  const events = new EventTarget()
  const media = Object.assign(events, { matches: false })
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList)
  const changed = vi.fn()
  const stop = await observeSystemTheme(changed)
  media.matches = true
  events.dispatchEvent(new Event('change'))
  expect(changed.mock.calls).toEqual([[false], [true]])
  stop()
  media.matches = false
  events.dispatchEvent(new Event('change'))
  expect(changed).toHaveBeenCalledTimes(2)
  expect(invoke).not.toHaveBeenCalled()
})
