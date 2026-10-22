import { expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { updateAppSettings } from './app-settings'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

test('rapid changes keep their write order and a failed save does not block later changes', async () => {
  let reject!: (reason: unknown) => void
  vi.mocked(invoke)
    .mockReturnValueOnce(new Promise((_, fail) => (reject = fail)))
    .mockResolvedValueOnce(undefined)
  const first = updateAppSettings({ theme: 'dark' })
  const failed = expect(first).rejects.toBe('busy')
  const second = updateAppSettings({ theme: 'light' })
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
  reject('busy')
  await failed
  await second
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ['app_update_settings', { patch: { theme: 'dark' } }],
    ['app_update_settings', { patch: { theme: 'light' } }],
  ])
})
