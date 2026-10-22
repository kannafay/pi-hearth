import { invoke } from '@tauri-apps/api/core'
import { dirname, downloadDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { beforeEach, expect, test, vi } from 'vitest'
import { chooseAttachments, getAttachmentPreview, prepareAttachmentPicker } from './attachments'
import type { Attachment } from './generated/pi'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({
  downloadDir: vi.fn().mockResolvedValue('D:/Downloads'),
  homeDir: vi.fn().mockResolvedValue('C:/Users/admin'),
  dirname: vi.fn().mockResolvedValue('D:/Documents'),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
const image: Attachment = {
  id: 'image',
  name: 'picture.png',
  kind: 'image',
  mimeType: 'image/png',
  size: 1024,
  preview: 'data:image/png;base64,thumbnail',
  sourcePath: 'D:/picture.png',
}
beforeEach(() => {
  vi.mocked(invoke).mockReset()
  vi.mocked(open).mockReset()
})

test('the warmed picker opens a file directory, remembers the selection and defers processing', async () => {
  await prepareAttachmentPicker()
  vi.mocked(open).mockResolvedValueOnce(['D:/Documents/notes.txt']).mockResolvedValueOnce(null)
  expect(await chooseAttachments()).toEqual(['D:/Documents/notes.txt'])
  expect(open).toHaveBeenNthCalledWith(1, {
    multiple: true,
    directory: false,
    title: '添加附件',
    defaultPath: 'D:/Downloads',
  })
  expect(dirname).toHaveBeenCalledWith('D:/Documents/notes.txt')
  expect(await chooseAttachments()).toEqual([])
  expect(open).toHaveBeenNthCalledWith(2, {
    multiple: true,
    directory: false,
    title: '添加附件',
    defaultPath: 'D:/Documents',
  })
  expect(downloadDir).toHaveBeenCalledTimes(1)
  expect(invoke).not.toHaveBeenCalled()
})

test('image preview loads the source file on demand instead of enlarging its thumbnail', async () => {
  const original = { kind: 'image', source: 'data:image/png;base64,original', text: null }
  vi.mocked(invoke).mockResolvedValue(original)
  expect(await getAttachmentPreview(image)).toEqual(original)
  expect(invoke).toHaveBeenCalledExactlyOnceWith('attachment_preview', { path: image.sourcePath })
})

test('historical images fall back to their saved preview if the original file is gone', async () => {
  vi.mocked(invoke).mockRejectedValue(new Error('附件不存在'))
  expect(await getAttachmentPreview(image)).toEqual({
    kind: 'image',
    source: image.preview,
    text: null,
  })
})

test('text attachments preview the content that was sent without re-reading a changed file', async () => {
  expect(await getAttachmentPreview({ ...image, kind: 'text', text: 'original content' })).toEqual({
    kind: 'text',
    source: null,
    text: 'original content',
  })
  expect(invoke).not.toHaveBeenCalled()
})
