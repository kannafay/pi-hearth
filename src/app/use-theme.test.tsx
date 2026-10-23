import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop, setWindowTheme } from '@/lib/desktop'
import { observeSystemTheme, usesNativeSystemTheme } from '@/lib/system-theme'
import { useTheme } from './use-theme'

vi.mock('@/lib/desktop', () => ({
  isDesktop: vi.fn(() => false),
  setWindowTheme: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/system-theme', () => ({
  observeSystemTheme: vi.fn(),
  usesNativeSystemTheme: vi.fn(() => true),
}))

let systemChanged: (dark: boolean) => void
const unlisten = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isDesktop).mockReturnValue(false)
  vi.mocked(usesNativeSystemTheme).mockReturnValue(true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.mocked(observeSystemTheme).mockImplementation(async (onChange) => {
    systemChanged = onChange
    return unlisten
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
})

test.each([false, true])(
  'same-color automatic and explicit choices do not repaint (%s)',
  (dark) => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: dark } as MediaQueryList)
    renderHook(useTheme)
    expect(setWindowTheme).toHaveBeenCalledExactlyOnceWith(dark ? 'dark' : 'light')
    const mutations = new MutationObserver(() => {})
    mutations.observe(document.documentElement, { attributes: true })
    act(() => useWorkspaceStore.getState().setTheme(dark ? 'dark' : 'light'))
    act(() => useWorkspaceStore.getState().setTheme('system'))
    expect(setWindowTheme).toHaveBeenCalledTimes(1)
    expect(mutations.takeRecords()).toHaveLength(0)
    mutations.disconnect()
    expect(document.documentElement.classList.contains('dark')).toBe(dark)
  },
)

test('system changes keep manual colors stable and returning to automatic uses the actual OS color', () => {
  renderHook(useTheme)
  act(() => useWorkspaceStore.getState().setTheme('dark'))
  act(() => systemChanged(true))
  act(() => useWorkspaceStore.getState().setTheme('system'))
  expect(vi.mocked(setWindowTheme).mock.calls).toEqual([['light'], ['dark']])
  act(() => systemChanged(false))
  expect(document.documentElement).not.toHaveClass('dark')
  expect(setWindowTheme).toHaveBeenLastCalledWith('light')
  act(() => useWorkspaceStore.getState().setTheme('light'))
  act(() => systemChanged(true))
  expect(document.documentElement).not.toHaveClass('dark')
  expect(setWindowTheme).toHaveBeenCalledTimes(3)
  act(() => useWorkspaceStore.getState().setTheme('system'))
  expect(document.documentElement).toHaveClass('dark')
  expect(setWindowTheme).toHaveBeenLastCalledWith('dark')
})

test('a late native subscription is cleaned up after unmount and cannot change the window', async () => {
  let finish!: (stop: () => void) => void
  vi.mocked(observeSystemTheme).mockImplementationOnce((onChange) => {
    systemChanged = onChange
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const view = renderHook(useTheme)
  view.unmount()
  await act(async () => {
    systemChanged(true)
    finish(unlisten)
  })
  expect(unlisten).toHaveBeenCalledOnce()
  expect(setWindowTheme).toHaveBeenCalledTimes(1)
})

test('other desktop platforms retain their native automatic-theme mode', () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.mocked(usesNativeSystemTheme).mockReturnValue(false)
  renderHook(useTheme)
  act(() => useWorkspaceStore.getState().setTheme('light'))
  act(() => useWorkspaceStore.getState().setTheme('system'))
  expect(vi.mocked(setWindowTheme).mock.calls).toEqual([[null], ['light'], [null]])
})
