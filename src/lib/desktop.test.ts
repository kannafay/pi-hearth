import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  getAppVersion,
  listenForWindowFocus,
  selectProjectDirectory,
  setWindowTheme,
} from '@/lib/desktop'

const nativeWindow = vi.hoisted(() => ({
  setTheme: vi.fn().mockResolvedValue(undefined),
  isFocused: vi.fn(),
  onFocusChanged: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => nativeWindow }))

beforeEach(() => {
  vi.clearAllMocks()
  nativeWindow.isFocused.mockReset()
  nativeWindow.onFocusChanged.mockReset()
})
afterEach(() => vi.restoreAllMocks())

test('desktop operations reject browser calls before invoking native APIs', async () => {
  vi.mocked(isTauri).mockReturnValue(false)
  await expect(getAppVersion()).rejects.toThrow('此操作需要在桌面应用中使用。')
  await expect(selectProjectDirectory()).rejects.toThrow('此操作需要在桌面应用中使用。')
  await setWindowTheme('dark')
  expect(invoke).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  expect(nativeWindow.setTheme).not.toHaveBeenCalled()
})

test('native window theme can switch appearance and return to following the system', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  await setWindowTheme('dark')
  await setWindowTheme(null)
  expect(nativeWindow.setTheme.mock.calls).toEqual([['dark'], [null]])
})

test('native focus subscription reads the initial state, forwards changes, and cleans up', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  const unlisten = vi.fn()
  let changed!: (event: { payload: boolean }) => void
  nativeWindow.onFocusChanged.mockImplementation(async (handler) => {
    changed = handler
    return unlisten
  })
  nativeWindow.isFocused.mockResolvedValue(true)
  const onChange = vi.fn()
  const stop = await listenForWindowFocus(onChange)
  expect(onChange).toHaveBeenLastCalledWith(true)
  changed({ payload: false })
  expect(onChange).toHaveBeenLastCalledWith(false)
  changed({ payload: true })
  expect(onChange).toHaveBeenLastCalledWith(true)
  stop()
  expect(unlisten).toHaveBeenCalledOnce()
})

test('a late initial focus result cannot overwrite a newer native event', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  let changed!: (event: { payload: boolean }) => void
  let resolveInitial!: (focused: boolean) => void
  nativeWindow.onFocusChanged.mockImplementation(async (handler) => {
    changed = handler
    return vi.fn()
  })
  nativeWindow.isFocused.mockReturnValue(
    new Promise<boolean>((resolve) => (resolveInitial = resolve)),
  )
  const onChange = vi.fn()
  const pending = listenForWindowFocus(onChange)
  await vi.waitFor(() => expect(nativeWindow.isFocused).toHaveBeenCalledOnce())
  changed({ payload: false })
  resolveInitial(true)
  const stop = await pending
  expect(onChange.mock.calls).toEqual([[false]])
  stop()
})

test('a failed initial native focus query releases its listener', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  const unlisten = vi.fn()
  nativeWindow.onFocusChanged.mockResolvedValue(unlisten)
  nativeWindow.isFocused.mockRejectedValue(new Error('focus unavailable'))
  await expect(listenForWindowFocus(vi.fn())).rejects.toThrow('focus unavailable')
  expect(unlisten).toHaveBeenCalledOnce()
})

test('desktop DOM focus updates immediately while the native query is pending', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  const unlisten = vi.fn()
  nativeWindow.onFocusChanged.mockResolvedValue(unlisten)
  let resolveInitial!: (focused: boolean) => void
  nativeWindow.isFocused.mockReturnValue(
    new Promise<boolean>((resolve) => (resolveInitial = resolve)),
  )
  const onChange = vi.fn()
  const pending = listenForWindowFocus(onChange)
  await vi.waitFor(() => expect(nativeWindow.isFocused).toHaveBeenCalledOnce())
  window.dispatchEvent(new Event('blur'))
  expect(onChange).toHaveBeenLastCalledWith(false)
  window.dispatchEvent(new Event('focus'))
  expect(onChange).toHaveBeenLastCalledWith(true)
  resolveInitial(false)
  const stop = await pending
  expect(onChange.mock.calls).toEqual([[false], [true]])
  stop()
  window.dispatchEvent(new Event('blur'))
  expect(onChange).toHaveBeenCalledTimes(2)
  expect(unlisten).toHaveBeenCalledOnce()
})

test('a failed native focus subscription also releases the DOM listeners', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  nativeWindow.onFocusChanged.mockRejectedValue(new Error('focus unavailable'))
  const onChange = vi.fn()
  await expect(listenForWindowFocus(onChange)).rejects.toThrow('focus unavailable')
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new Event('blur'))
  expect(onChange).not.toHaveBeenCalled()
})

test('browser focus uses DOM events and removes both listeners on cleanup', async () => {
  vi.mocked(isTauri).mockReturnValue(false)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const onChange = vi.fn()
  const stop = await listenForWindowFocus(onChange)
  window.dispatchEvent(new Event('blur'))
  window.dispatchEvent(new Event('focus'))
  expect(onChange.mock.calls).toEqual([[true], [false], [true]])
  stop()
  window.dispatchEvent(new Event('blur'))
  expect(onChange).toHaveBeenCalledTimes(3)
  expect(nativeWindow.onFocusChanged).not.toHaveBeenCalled()
})
