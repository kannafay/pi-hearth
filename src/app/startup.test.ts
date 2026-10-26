import { expect, test, vi } from 'vitest'
import script from '../../public/startup.js?raw'

function bootstrap({ decode = Promise.resolve(), desktop = true } = {}) {
  const frames: Array<() => void> = []
  const timers: Array<() => void> = []
  const invoke = vi.fn().mockResolvedValue(undefined)
  const clearTimeout = vi.fn()
  // Run the dependency-free bootstrap with isolated browser primitives.
  const run = new Function(
    'window',
    'document',
    'requestAnimationFrame',
    'setTimeout',
    'clearTimeout',
    'console',
    script,
  )
  run(
    { __TAURI_INTERNALS__: desktop ? { invoke } : undefined },
    { querySelector: () => ({ decode: () => decode }) },
    (callback: () => void) => frames.push(callback),
    (callback: () => void) => timers.push(callback),
    clearTimeout,
    console,
  )
  return { frames, timers, invoke, clearTimeout }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('the native window waits for the logo and two paint opportunities before appearing', async () => {
  let finish!: () => void
  const boot = bootstrap({ decode: new Promise<void>((resolve) => (finish = resolve)) })
  expect(boot.frames).toHaveLength(0)
  finish()
  await settle()
  expect(boot.invoke).not.toHaveBeenCalled()
  boot.frames.shift()!()
  expect(boot.invoke).not.toHaveBeenCalled()
  boot.frames.shift()!()
  expect(boot.invoke).toHaveBeenCalledExactlyOnceWith('window_startup_ready')
  expect(boot.clearTimeout).toHaveBeenCalledOnce()
})

test('a throttled or reloaded renderer does not hide the window or reveal it twice', async () => {
  const boot = bootstrap({ decode: Promise.reject(new Error('missing image')) })
  await settle()
  boot.timers[0]()
  expect(boot.invoke).toHaveBeenCalledOnce()
  boot.frames.shift()!()
  boot.frames.shift()!()
  expect(boot.invoke).toHaveBeenCalledOnce()
})

test('the static loader works in browser previews without native commands', async () => {
  const boot = bootstrap({ desktop: false })
  await settle()
  expect(boot.invoke).not.toHaveBeenCalled()
  expect(boot.frames).toHaveLength(0)
  expect(boot.timers).toHaveLength(0)
})
