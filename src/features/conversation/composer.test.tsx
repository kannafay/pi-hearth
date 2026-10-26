import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from './store'
import { Composer } from './composer'
import { Toaster } from '@/components/ui/toast'
import {
  chooseAttachments,
  clipboardAttachments,
  hasClipboardAttachments,
  listenForAttachmentDrop,
  releaseAttachments,
  stageFiles,
  stagePaths,
} from '@/lib/attachments'
import type { Attachment } from '@/lib/generated/pi'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))
vi.mock('@/lib/attachments', () => ({
  chooseAttachments: vi.fn(),
  clipboardAttachments: vi.fn(),
  hasClipboardAttachments: vi.fn(),
  releaseAttachments: vi.fn(),
  stageFiles: vi.fn(),
  stagePaths: vi.fn(),
  MAX_ATTACHMENTS: 10,
  prepareAttachmentPicker: vi.fn().mockResolvedValue('D:/Downloads'),
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
  vi.mocked(chooseAttachments).mockResolvedValue(['D:/notes.txt'])
  vi.mocked(stagePaths).mockResolvedValue([file])
  vi.mocked(clipboardAttachments).mockResolvedValue([])
  vi.mocked(hasClipboardAttachments).mockResolvedValue(false)
  vi.mocked(stageFiles).mockResolvedValue([file])
})

test('clicking composer padding and toolbar gaps focuses the draft without moving the caret', async () => {
  useWorkspaceStore.setState({ draft: '保留草稿' })
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' }) as HTMLTextAreaElement
  const areas = [
    screen.getByLabelText('消息输入区'),
    input.parentElement!,
    screen.getByRole('button', { name: '发送消息' }).parentElement!,
  ]

  for (const area of areas) {
    await user.click(document.body)
    input.setSelectionRange(2, 2)
    await user.click(area)
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(2)
  }

  await user.keyboard('继续')
  expect(input).toHaveValue('保留继续草稿')
})

test('composer attachment controls keep their own actions without focusing the draft', async () => {
  vi.mocked(chooseAttachments).mockResolvedValue([])
  useWorkspaceStore.setState({ draftAttachments: [file] })
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })

  await user.click(screen.getByRole('button', { name: '添加附件' }))
  expect(chooseAttachments).toHaveBeenCalledOnce()
  expect(input).not.toHaveFocus()

  await user.click(screen.getByText('notes.txt'))
  expect(useWorkspaceStore.getState().attachmentPreview).toEqual(file)
  expect(input).not.toHaveFocus()

  await user.click(screen.getByRole('button', { name: '移除 notes.txt' }))
  expect(useWorkspaceStore.getState().draftAttachments).toEqual([])
  expect(input).not.toHaveFocus()
})

test('composer dropdown triggers and their portalled options do not focus the draft', async () => {
  const first = { provider: 'p', id: 'a', name: 'Alpha' }
  const second = { provider: 'p', id: 'b', name: 'Beta' }
  const changeModel = vi.fn().mockResolvedValue(undefined)
  const changeThinkingLevel = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({
    model: first,
    models: [first, second],
    availableThinkingLevels: ['high'],
    changeModel,
    changeThinkingLevel,
  })
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })

  await user.click(screen.getByRole('combobox', { name: '切换模型' }))
  expect(input).not.toHaveFocus()
  await user.click(await screen.findByRole('option', { name: 'Beta' }))
  expect(changeModel).toHaveBeenCalledExactlyOnceWith(second)
  expect(input).not.toHaveFocus()

  await user.click(screen.getByRole('combobox', { name: '思考强度' }))
  expect(input).not.toHaveFocus()
  await user.click(await screen.findByRole('option', { name: 'High' }))
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('high')
  expect(input).not.toHaveFocus()
})

test.each(['ready', 'connecting', 'running', 'stopping', 'disconnected'] as const)(
  '%s conversations keep all notices above the input area',
  (status) => {
    useConversationStore.setState({
      status,
      activity: '等待回复…',
      connectionTarget: { projectPath: null, sessionPath: null },
    })
    render(<Composer onSendStart={() => {}} />)
    const inputArea = screen.getByLabelText('消息输入区')
    expect(inputArea.parentElement!.lastElementChild).toBe(inputArea)
    expect(screen.queryByText('等待回复…')).not.toBeInTheDocument()
    expect(screen.queryByText('请配置模型')).not.toBeInTheDocument()
    if (status === 'disconnected') {
      const retry = screen.getByRole('button', { name: '重新连接' })
      expect(
        retry.compareDocumentPosition(inputArea) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  },
)

test('native drops do not become chat attachments while a dialog makes the workspace inert', async () => {
  const { container } = render(
    <div inert>
      <Composer onSendStart={() => {}} />
    </div>,
  )
  const [onOver, onDrop] = vi.mocked(listenForAttachmentDrop).mock.calls.at(-1)!
  act(() => {
    onOver(true)
    onDrop(['D:/project-folder'])
  })
  expect(stagePaths).not.toHaveBeenCalled()
  expect(screen.queryByPlaceholderText('松开以添加附件')).not.toBeInTheDocument()
  container.firstElementChild!.removeAttribute('inert')
  act(() => onDrop(['D:/notes.txt']))
  await waitFor(() => expect(stagePaths).toHaveBeenCalledExactlyOnceWith(['D:/notes.txt']))
})

test('the project shelf slides out for a new conversation and stays mounted while hiding during a reply', async () => {
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  const picker = screen.getByRole('combobox', { name: '选择对话项目' })
  const shelf = picker.closest('.composer-project-reveal')!
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  expect(shelf).toHaveAttribute('data-open', 'true')
  expect(shelf.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await user.click(picker)
  expect(await screen.findByRole('combobox', { name: '搜索项目名称或路径' })).toBeVisible()

  act(() => useConversationStore.setState({ status: 'running' }))
  expect(shelf).toHaveAttribute('data-open', 'false')
  expect(shelf).toHaveAttribute('inert')
  expect(picker).toBeInTheDocument()
  expect(picker).toBeDisabled()
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  act(() =>
    useConversationStore.setState({
      status: 'ready',
      messages: [
        { id: 'sent', role: 'user', text: '已发送', thinking: '', status: 'complete', error: null },
      ],
    }),
  )
  expect(shelf).toHaveAttribute('data-open', 'false')
  act(() =>
    useConversationStore.setState({
      status: 'connecting',
      messages: [],
      connectionTarget: { projectPath: null, sessionPath: null },
    }),
  )
  expect(shelf).toHaveAttribute('data-open', 'true')
  expect(screen.getByRole('combobox', { name: '选择对话项目' })).toBe(picker)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
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

test('the picker does not show an import spinner until files are selected', async () => {
  let select!: (paths: string[]) => void
  let finishImport!: (files: Attachment[]) => void
  vi.mocked(chooseAttachments).mockReturnValue(
    new Promise((resolve) => {
      select = resolve
    }),
  )
  vi.mocked(stagePaths).mockReturnValue(
    new Promise((resolve) => {
      finishImport = resolve
    }),
  )
  render(<Composer onSendStart={() => {}} />)
  const button = screen.getByRole('button', { name: '添加附件' })
  fireEvent.click(button)
  expect(button).toBeDisabled()
  expect(button.querySelector('.animate-spin')).toBeNull()
  expect(stagePaths).not.toHaveBeenCalled()
  await act(async () => select(['D:/notes.txt']))
  expect(button.querySelector('.animate-spin')).not.toBeNull()
  expect(stagePaths).toHaveBeenCalledExactlyOnceWith(['D:/notes.txt'])
  await act(async () => finishImport([file]))
  expect(screen.getByText('notes.txt')).toBeVisible()
  expect(button).toBeEnabled()
})

test('canceling the picker leaves the draft intact and skips file processing', async () => {
  vi.mocked(chooseAttachments).mockResolvedValue([])
  useWorkspaceStore.setState({ draft: '保留草稿', draftAttachments: [file] })
  render(<Composer onSendStart={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: '添加附件' }))
  expect(stagePaths).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().draft).toBe('保留草稿')
  expect(useWorkspaceStore.getState().draftAttachments).toEqual([file])
  expect(screen.getByRole('button', { name: '添加附件' })).toBeEnabled()
})

test('a picker result cannot add files to a different conversation', async () => {
  let select!: (paths: string[]) => void
  vi.mocked(chooseAttachments).mockReturnValue(
    new Promise((resolve) => {
      select = resolve
    }),
  )
  render(<Composer onSendStart={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '添加附件' }))
  act(() => useConversationStore.setState({ instanceId: 'other-runtime' }))
  await act(async () => select(['D:/notes.txt']))
  expect(stagePaths).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().draftAttachments).toEqual([])
})

test('attachment failures notify at the top and stale failures do not interrupt another conversation', async () => {
  vi.mocked(stagePaths).mockRejectedValueOnce(new Error('无法读取附件'))
  const user = userEvent.setup()
  const { container } = render(
    <>
      <Toaster />
      <Composer onSendStart={() => {}} />
    </>,
  )
  await user.click(screen.getByRole('button', { name: '添加附件' }))
  const notice = await screen.findByRole('dialog', { name: '操作失败' })
  expect(notice).toHaveAccessibleDescription('无法读取附件')
  expect(container).not.toContainElement(notice)
  let reject!: (reason: Error) => void
  vi.mocked(stagePaths).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  await user.click(screen.getByRole('button', { name: '添加附件' }))
  act(() => useConversationStore.setState({ instanceId: 'another-runtime' }))
  await act(async () => reject(new Error('旧会话附件错误')))
  expect(screen.queryByText('旧会话附件错误')).not.toBeInTheDocument()
})

test('drafts stay editable while settings are applied and Enter cannot race the change', async () => {
  useConversationStore.setState({ settingsPending: 'thinking' })
  const user = userEvent.setup()
  render(<Composer onSendStart={() => {}} />)
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  expect(input).toHaveAttribute('placeholder', '发送消息，输入 / 使用命令，@ 引用文件…')
  await user.type(input, '继续编辑{Enter}')
  expect(input).toHaveValue('继续编辑')
  expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
  expect(useConversationStore.getState().send).not.toHaveBeenCalled()
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
  vi.mocked(hasClipboardAttachments).mockResolvedValue(true)
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
  const input = screen.getByRole('textbox', { name: '消息草稿' })
  await user.click(input)
  fireEvent.keyDown(input, { ctrlKey: true, key: 'v' })
  const attachmentButton = screen.getByRole('button', { name: '添加附件' })
  expect(attachmentButton).toBeEnabled()
  expect(attachmentButton.querySelector('.animate-spin')).toBeNull()
  await user.paste('粘贴一段普通文本')
  expect(useWorkspaceStore.getState().draft).toBe('粘贴一段普通文本')
  expect(clipboardAttachments).not.toHaveBeenCalled()
  expect(stageFiles).not.toHaveBeenCalled()
})

test('native image or file import shows loading only after clipboard formats confirm an attachment', async () => {
  let finishProbe!: (available: boolean) => void
  let finishImport!: (files: Attachment[]) => void
  vi.mocked(hasClipboardAttachments).mockReturnValue(
    new Promise((resolve) => {
      finishProbe = resolve
    }),
  )
  vi.mocked(clipboardAttachments).mockReturnValue(
    new Promise((resolve) => {
      finishImport = resolve
    }),
  )
  render(<Composer onSendStart={() => {}} />)
  fireEvent.keyDown(screen.getByRole('textbox', { name: '消息草稿' }), { ctrlKey: true, key: 'v' })
  const button = screen.getByRole('button', { name: '添加附件' })
  expect(button).toBeEnabled()
  expect(button.querySelector('.animate-spin')).toBeNull()
  await act(async () => finishProbe(true))
  expect(button).toBeDisabled()
  expect(button.querySelector('.animate-spin')).not.toBeNull()
  await act(async () => finishImport([file]))
  expect(screen.getByText(file.name)).toBeVisible()
  expect(button).toBeEnabled()
  expect(button.querySelector('.animate-spin')).toBeNull()
})

test('sending during the format check waits for the attachment and uses the latest draft', async () => {
  let finishProbe!: (available: boolean) => void
  vi.mocked(hasClipboardAttachments).mockReturnValue(
    new Promise((resolve) => {
      finishProbe = resolve
    }),
  )
  vi.mocked(clipboardAttachments).mockResolvedValue([file])
  useWorkspaceStore.setState({ draft: '总结附件' })
  render(<Composer onSendStart={() => {}} />)
  fireEvent.keyDown(screen.getByRole('textbox', { name: '消息草稿' }), { ctrlKey: true, key: 'v' })
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
  expect(useConversationStore.getState().send).not.toHaveBeenCalled()
  await act(async () => finishProbe(true))
  expect(useConversationStore.getState().send).toHaveBeenCalledExactlyOnceWith('总结附件', [
    file.id,
  ])
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
