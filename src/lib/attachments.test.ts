import { invoke } from '@tauri-apps/api/core'
import { beforeEach, expect, test, vi } from 'vitest'
import { getAttachmentPreview } from './attachments'
import type { Attachment } from './generated/pi'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
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
