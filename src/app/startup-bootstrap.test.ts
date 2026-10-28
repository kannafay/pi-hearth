import { afterEach, expect, test, vi } from 'vitest'
import source from '../../public/startup.js?raw'

function boot(decode: () => Promise<void>, invoke = vi.fn().mockResolvedValue(undefined)) {
  const frames: (() => void)[] = []
  const window = {
    __TAURI_INTERNALS__: { invoke },
    __HEARTH_STARTUP_READY__: undefined as Promise<void> | undefined,
  }
  const run = new Function(
    'document',
    'window',
    'setTimeout',
    'clearTimeout',
    'requestAnimationFrame',
    'console',
    source,
  )
  run(
    { querySelector: () => ({ decode }) },
    window,
    setTimeout,
    clearTimeout,
    (callback: () => void) => frames.push(callback),
    console,
  )
  return { invoke, frames, ready: window.__HEARTH_STARTUP_READY__ }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('a pending logo decode cannot keep the native window hidden', async () => {
  vi.useFakeTimers()
  let finishDecode!: () => void
  const { invoke, frames, ready } = boot(
    () =>
      new Promise<void>((resolve) => {
        finishDecode = resolve
      }),
  )
  await vi.advanceTimersByTimeAsync(1000)
  expect(invoke).toHaveBeenCalledExactlyOnceWith('window_startup_ready')
  await expect(ready).resolves.toBeUndefined()

  finishDecode()
  await vi.advanceTimersByTimeAsync(0)
  while (frames.length) frames.shift()!()
  expect(invoke).toHaveBeenCalledOnce()
})

test('a painted logo reveals the window once without waiting for the fallback', async () => {
  vi.useFakeTimers()
  const { invoke, frames } = boot(() => Promise.resolve())
  await vi.advanceTimersByTimeAsync(0)
  while (frames.length) frames.shift()!()
  expect(invoke).toHaveBeenCalledExactlyOnceWith('window_startup_ready')
  await vi.advanceTimersByTimeAsync(1000)
  expect(invoke).toHaveBeenCalledOnce()
})

test('workspace loading waits until native window presentation has completed', async () => {
  vi.useFakeTimers()
  let presented!: () => void
  const invoke = vi.fn().mockReturnValue(
    new Promise<void>((resolve) => {
      presented = resolve
    }),
  )
  const { ready } = boot(() => new Promise(() => {}), invoke)
  const loadWorkspace = vi.fn()
  void ready!.then(loadWorkspace)
  await vi.advanceTimersByTimeAsync(1000)
  expect(invoke).toHaveBeenCalledOnce()
  expect(loadWorkspace).not.toHaveBeenCalled()
  presented()
  await ready
  expect(loadWorkspace).toHaveBeenCalledOnce()
})

test('a rejected native reveal still releases workspace loading', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const invoke = vi.fn().mockRejectedValue(new Error('unavailable'))
  const { ready } = boot(() => new Promise(() => {}), invoke)
  await vi.advanceTimersByTimeAsync(1000)
  await expect(ready).resolves.toBeUndefined()
})
