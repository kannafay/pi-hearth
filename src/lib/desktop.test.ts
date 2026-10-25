import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  finishWindowThemeChange,
  getAppVersion,
  selectProjectDirectory,
  setWindowTheme,
} from '@/lib/desktop'

const nativeWindow = vi.hoisted(() => ({ setTheme: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => nativeWindow }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

test('desktop operations reject browser calls before invoking native APIs', async () => {
  vi.mocked(isTauri).mockReturnValue(false)
  await expect(getAppVersion()).rejects.toThrow('此操作需要在桌面应用中使用。')
  await expect(selectProjectDirectory()).rejects.toThrow('此操作需要在桌面应用中使用。')
  await setWindowTheme('dark')
  await finishWindowThemeChange('browser-request')
  expect(invoke).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  expect(nativeWindow.setTheme).not.toHaveBeenCalled()
})

test('Windows presentation preparation and completion carry the same request identity', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  await setWindowTheme('dark', 'theme-request')
  await finishWindowThemeChange('theme-request')
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ['set_window_theme', { theme: 'dark', transitionId: 'theme-request' }],
    ['finish_window_theme_change', { transitionId: 'theme-request' }],
  ])
})

test('native window theme can switch appearance and return to following the system', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  await setWindowTheme('dark')
  await setWindowTheme(null)
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ['set_window_theme', { theme: 'dark' }],
    ['set_window_theme', { theme: null }],
  ])
})
