import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from './store'
import { Composer } from './composer'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))
vi.mock('@/lib/attachments', () => ({
  MAX_ATTACHMENTS: 10,
  releaseAttachments: vi.fn(),
  prepareAttachmentPicker: vi.fn().mockResolvedValue('D:/Downloads'),
  listenForAttachmentDrop: vi.fn().mockResolvedValue(() => {}),
  hasClipboardAttachments: vi.fn().mockResolvedValue(false),
  clipboardAttachments: vi.fn().mockResolvedValue([]),
  chooseAttachments: vi.fn(),
  stageFiles: vi.fn(),
  stagePaths: vi.fn(),
}))

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
})

test('an old send acknowledgement cannot clear the same text drafted in a different session', async () => {
  let acknowledge!: (sent: boolean) => void
  const send = vi.fn().mockReturnValue(
    new Promise<boolean>((resolve) => {
      acknowledge = resolve
    }),
  )
  useConversationStore.setState({ instanceId: 'A', status: 'ready', send })
  useWorkspaceStore.setState({ draft: 'same text' })
  render(<Composer onSendStart={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
  expect(send).toHaveBeenCalledExactlyOnceWith('same text', [])
  act(() => useConversationStore.setState({ instanceId: 'B', status: 'ready' }))
  // A different chat may coincidentally have exactly the same draft content.
  act(() => useWorkspaceStore.setState({ draft: 'same text' }))
  await act(async () => acknowledge(true))
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: '消息草稿' })).toHaveValue('same text'),
  )
})
