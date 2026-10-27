import { expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { changeProjectsDirectory, updateAppSettings } from './app-settings'

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

test('directory migrations share the preference queue with earlier and later changes', async () => {
  let finish!: () => void
  vi.mocked(invoke)
    .mockReset()
    .mockResolvedValueOnce(undefined)
    .mockReturnValueOnce(new Promise((resolve) => (finish = () => resolve({ paths: [] }))))
    .mockResolvedValueOnce(undefined)
  const first = updateAppSettings({ theme: 'dark' })
  const migration = changeProjectsDirectory('E:/Projects')
  const last = updateAppSettings({ theme: 'light' })
  await first
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
  expect(vi.mocked(invoke).mock.calls[1]).toEqual([
    'workspace_change_projects_directory',
    { directory: 'E:/Projects' },
  ])
  finish()
  await migration
  await last
  expect(vi.mocked(invoke).mock.calls[2]).toEqual([
    'app_update_settings',
    { patch: { theme: 'light' } },
  ])
})
