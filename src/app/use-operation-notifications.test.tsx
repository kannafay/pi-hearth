import { act, renderHook } from '@testing-library/react'
import { StrictMode, type PropsWithChildren } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from './store'
import { useConversationStore } from '@/features/conversation/store'
import { toast } from '@/lib/toast'
import { useOperationNotifications } from './use-operation-notifications'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
})

test('new errors notify once, retries can notify again, and old errors are not replayed on mount', () => {
  useConversationStore.setState({ error: '历史错误' })
  const { unmount } = renderHook(useOperationNotifications, {
    wrapper: ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>,
  })
  expect(toast.error).not.toHaveBeenCalled()
  act(() => {
    useConversationStore.setState({ error: '执行失败' })
    useConversationStore.setState({ activity: '状态变化' })
    useConversationStore.setState({ error: '执行失败' })
  })
  expect(toast.error).toHaveBeenCalledExactlyOnceWith('执行失败')
  act(() => {
    useConversationStore.setState({ error: null })
    useConversationStore.setState({ error: '执行失败' })
    useWorkspaceStore.setState({ error: '无法保存设置' })
  })
  expect(vi.mocked(toast.error).mock.calls).toEqual([['执行失败'], ['执行失败'], ['无法保存设置']])
  unmount()
  act(() => useWorkspaceStore.setState({ error: '卸载后' }))
  expect(toast.error).toHaveBeenCalledTimes(3)
})
