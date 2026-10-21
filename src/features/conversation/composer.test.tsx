import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from './store'
import { Composer } from './composer'
import {
  chooseAttachments,
  clipboardAttachments,
  releaseAttachments,
  stageFiles,
} from '@/lib/attachments'
import type { Attachment } from '@/lib/generated/pi'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))
vi.mock('@/lib/attachments', () => ({
  chooseAttachments: vi.fn(),
  clipboardAttachments: vi.fn(),
  releaseAttachments: vi.fn(),
  stageFiles: vi.fn(),
  stagePaths: vi.fn(),
  MAX_ATTACHMENTS: 10,
  listenForAttachmentDrop: vi.fn().mockResolvedValue(() => {}),
}))
const file: Attachment = {
  id: 'file-1',
  name: 'notes.txt',
  kind: 'text',
  mimeType: 'text/plain',
  size: 48,
  preview: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({
    instanceId: 'runtime',
    status: 'ready',
    send: vi.fn().mockResolvedValue(true),
  })
  vi.mocked(chooseAttachments).mockResolvedValue([file])
  vi.mocked(clipboardAttachments).mockResolvedValue([])
  vi.mocked(stageFiles).mockResolvedValue([file])
})

test('selected files are sent with the draft and cleared only after acceptance', async () => {
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  await user.click(screen.getByRole('button', { name: '添加附件' }))
  expect(await screen.findByText('notes.txt')).toBeVisible()
  await user.type(screen.getByRole('textbox', { name: '消息草稿' }), '总结附件')
  await user.click(screen.getByRole('button', { name: '发送消息' }))
  expect(useConversationStore.getState().send).toHaveBeenCalledWith('总结附件', ['file-1'])
  expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
  expect(useWorkspaceStore.getState().draft).toBe('')
})

test('pasted browser files can be removed before sending', async () => {
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  const pasted = new File(['text'], 'notes.txt', { type: 'text/plain' })
  fireEvent.paste(screen.getByRole('textbox', { name: '消息草稿' }), {
    clipboardData: { files: [pasted], getData: () => '' },
  })
  expect(await screen.findByText('notes.txt')).toBeVisible()
  expect(stageFiles).toHaveBeenCalledWith([pasted])
  await user.click(screen.getByRole('button', { name: '移除 notes.txt' }))
  expect(releaseAttachments).toHaveBeenCalledWith(['file-1'])
  expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
})

test('native file paste and the DOM paste event add one attachment and support files-only messages', async () => {
  vi.mocked(clipboardAttachments).mockResolvedValue([file])
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  fireEvent.keyDown(input, { ctrlKey: true, key: 'v' })
  fireEvent.paste(input, {
    clipboardData: { files: [new File(['x'], 'notes.txt')], getData: () => '' },
  })
  await waitFor(() => expect(useWorkspaceStore.getState().draftAttachments).toHaveLength(1))
  expect(stageFiles).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
  await waitFor(() =>
    expect(useConversationStore.getState().send).toHaveBeenCalledWith('', ['file-1']),
  )
})

test('ordinary pasted text remains text and does not create attachments', async () => {
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  await user.click(screen.getByRole('textbox', { name: '消息草稿' }))
  await user.paste('粘贴一段普通文本')
  expect(useWorkspaceStore.getState().draft).toBe('粘贴一段普通文本')
  expect(clipboardAttachments).not.toHaveBeenCalled()
  expect(stageFiles).not.toHaveBeenCalled()
})

test('rejected messages retain attachments for retry', async () => {
  useWorkspaceStore.setState({ draftAttachments: [file], draft: '重试' })
  useConversationStore.setState({ send: vi.fn().mockResolvedValue(false) })
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  await user.click(screen.getByRole('button', { name: '发送消息' }))
  expect(screen.getByText('notes.txt')).toBeVisible()
  expect(useWorkspaceStore.getState().draft).toBe('重试')
})
