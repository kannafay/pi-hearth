import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from './store'
import { useConversationStore } from '@/features/conversation/store'
import { releaseAttachments, restoreAttachments } from '@/lib/attachments'
import { loadCatalog } from '@/lib/workspace'
import { composerDraftKey, loadComposerDraft, saveComposerDraft } from '@/lib/composer-drafts'
import type { Attachment, SessionInfo } from '@/lib/generated/pi'

vi.mock('@/lib/attachments', () => ({ releaseAttachments: vi.fn(), restoreAttachments: vi.fn() }))
vi.mock('@/lib/workspace', async (original) => ({
  ...(await original<typeof import('@/lib/workspace')>()),
  loadCatalog: vi.fn(),
}))

const first: SessionInfo = {
  id: 'first',
  path: 'D:/sessions/first.jsonl',
  cwd: 'D:/project',
  title: 'First',
  modified: 1,
  messageCount: 2,
}
const second: SessionInfo = {
  ...first,
  id: 'second',
  path: 'D:/sessions/second.jsonl',
  title: 'Second',
}
const file: Attachment = {
  id: 'file-1',
  name: 'notes.txt',
  kind: 'text',
  mimeType: 'text/plain',
  size: 12,
  sourcePath: 'D:/Files/Uploads/file-1/notes.txt',
  preview: null,
  text: 'attachment content',
}
beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ status: 'ready', connect: vi.fn().mockResolvedValue(undefined) })
  vi.mocked(restoreAttachments).mockImplementation(async (files) =>
    files.map((file) => ({ ...file, text: 'restored content' })),
  )
  vi.mocked(loadCatalog).mockResolvedValue({
    projects: [{ path: first.cwd, name: 'project' }],
    sessions: [first, second],
    generalCwd: 'D:/general',
    selection: { projectPath: first.cwd, sessionPath: first.path },
    sessionPreferences: {},
  })
})

test('every edit survives an immediate reload and startup restores the selected conversation', async () => {
  await useWorkspaceStore.getState().initialize()
  useWorkspaceStore.getState().setDraft('  未发送的文字\n最后一个字😀')
  expect(loadComposerDraft(composerDraftKey(first.cwd, first.id)).text).toBe(
    '  未发送的文字\n最后一个字😀',
  )
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  await useWorkspaceStore.getState().initialize()
  expect(useWorkspaceStore.getState().draft).toBe('  未发送的文字\n最后一个字😀')
})

test('conversations retain independent drafts and restore sendable attachments without storing payloads', async () => {
  await useWorkspaceStore.getState().openSession(first)
  useWorkspaceStore.getState().setDraft('第一份草稿')
  const image = {
    ...file,
    id: 'image-1',
    kind: 'image',
    name: 'photo.png',
    preview: 'data:image/png;base64,large-preview',
  }
  useWorkspaceStore.getState().addAttachments([file, image])
  const stored = loadComposerDraft(composerDraftKey(first.cwd, first.id))
  expect(stored.attachments[0].text).toBeUndefined()
  expect(stored.attachments[1].preview).toBeNull()
  expect(stored.attachments[1].sourcePath).toBe(image.sourcePath)
  await useWorkspaceStore.getState().openSession(second)
  expect(useWorkspaceStore.getState().draft).toBe('')
  expect(useWorkspaceStore.getState().draftAttachments).toEqual([])
  useWorkspaceStore.getState().setDraft('第二份草稿')
  await useWorkspaceStore.getState().openSession(first)
  expect(useWorkspaceStore.getState().draft).toBe('第一份草稿')
  expect(useWorkspaceStore.getState().draftAttachments.map((file) => file.id)).toEqual([
    'file-1',
    'image-1',
  ])
  expect(restoreAttachments).toHaveBeenCalledWith(stored.attachments)
  expect(releaseAttachments).toHaveBeenCalledWith(['file-1', 'image-1'])
  expect(useWorkspaceStore.getState().draftAttachments[0].text).toBe('restored content')
})

test('a new project draft survives startup before any native conversation has been saved', async () => {
  await useWorkspaceStore.getState().newConversation(first.cwd)
  useWorkspaceStore.getState().setDraft('还没发送过')
  vi.mocked(loadCatalog).mockResolvedValueOnce({
    projects: [{ path: first.cwd, name: 'project' }],
    sessions: [],
    generalCwd: 'D:/general',
    selection: { projectPath: first.cwd, sessionPath: null },
    sessionPreferences: {},
  })
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  await useWorkspaceStore.getState().initialize()
  expect(useWorkspaceStore.getState().draft).toBe('还没发送过')
})

test('project selection transfers the draft and acceptance clears its identity after session promotion', async () => {
  await useWorkspaceStore.getState().activateDraft(composerDraftKey(null))
  useWorkspaceStore.getState().setDraft('随项目一起移动')
  useWorkspaceStore.getState().addAttachments([file])
  const id = useWorkspaceStore.getState().draftId
  await useWorkspaceStore.getState().newConversation(first.cwd, { preserveDraft: true })
  expect(useWorkspaceStore.getState().draft).toBe('随项目一起移动')
  expect(loadComposerDraft(composerDraftKey(null)).text).toBe('')
  await useWorkspaceStore.getState().activateDraft(composerDraftKey(first.cwd, first.id), true)
  await useWorkspaceStore.getState().openSession(second)
  useWorkspaceStore.getState().setDraft('随项目一起移动')
  useWorkspaceStore.getState().completeDraft(id, '随项目一起移动', ['file-1'])
  expect(useWorkspaceStore.getState().draft).toBe('随项目一起移动')
  expect(loadComposerDraft(composerDraftKey(first.cwd, first.id)).text).toBe('')
  expect(loadComposerDraft(composerDraftKey(first.cwd, first.id)).attachments).toEqual([])
})

test('acceptance keeps edits and new attachments made while the submission was pending', async () => {
  await useWorkspaceStore.getState().openSession(first)
  useWorkspaceStore.getState().setDraft('正在发送')
  useWorkspaceStore.getState().addAttachments([file])
  const id = useWorkspaceStore.getState().draftId
  useWorkspaceStore.getState().setDraft('下一轮要发送')
  useWorkspaceStore.getState().addAttachments([{ ...file, id: 'next' }])
  useWorkspaceStore.getState().completeDraft(id, '正在发送', ['file-1'])
  expect(loadComposerDraft(composerDraftKey(first.cwd, first.id))).toMatchObject({
    text: '下一轮要发送',
    attachments: [{ id: 'next' }],
  })
})

test('a late attachment restoration cannot replace another conversation or its draft', async () => {
  saveComposerDraft('session:first', { id: 'draft-first', text: '第一份', attachments: [file] })
  let finish!: (files: Attachment[]) => void
  vi.mocked(restoreAttachments).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const opening = useWorkspaceStore.getState().openSession(first)
  expect(useWorkspaceStore.getState().draftRestoring).toBe(true)
  await useWorkspaceStore.getState().openSession(second)
  useWorkspaceStore.getState().setDraft('第二份')
  finish([file])
  await opening
  expect(useWorkspaceStore.getState()).toMatchObject({
    draft: '第二份',
    draftAttachments: [],
    draftRestoring: false,
  })
})

test('missing attachments retain their cards and text and can be retried or removed', async () => {
  saveComposerDraft('session:first', { id: 'draft-first', text: '保留文字', attachments: [file] })
  vi.mocked(restoreAttachments).mockRejectedValueOnce(
    new Error('无法恢复附件“notes.txt”，请移除后重新添加。'),
  )
  await useWorkspaceStore.getState().openSession(first)
  expect(useWorkspaceStore.getState()).toMatchObject({
    draft: '保留文字',
    draftNeedsRestore: true,
    draftRestoring: false,
  })
  expect(useWorkspaceStore.getState().draftAttachments[0].name).toBe('notes.txt')
  expect(await useWorkspaceStore.getState().restoreDraftAttachments()).toBe(true)
  useWorkspaceStore.getState().clearAttachments(['file-1'])
  expect(loadComposerDraft('session:first')).toMatchObject({ text: '保留文字', attachments: [] })
})

test('an unavailable storage reports the failed save while keeping the current text', async () => {
  await useWorkspaceStore.getState().openSession(first)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota exceeded')
  })
  useWorkspaceStore.getState().setDraft('保留在输入框')
  expect(useWorkspaceStore.getState().draft).toBe('保留在输入框')
  expect(useWorkspaceStore.getState().error).toContain('无法自动保存草稿')
})
