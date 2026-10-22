import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { getAttachmentPreview } from '@/lib/attachments'
import type { Attachment } from '@/lib/generated/pi'
import { AttachmentPreviewDialog } from './attachment-preview-dialog'

vi.mock('@/lib/attachments', () => ({ getAttachmentPreview: vi.fn() }))
const file: Attachment = {
  id: 'image',
  name: 'picture.png',
  kind: 'image',
  mimeType: 'image/png',
  size: 1024,
  preview: null,
}
beforeEach(() => {
  vi.mocked(getAttachmentPreview).mockReset()
})

test.each(['image', 'video', 'audio', 'text'])(
  '%s previews enter from closed and release their content after dismissal',
  async (kind) => {
    vi.mocked(getAttachmentPreview).mockResolvedValue({
      kind,
      source: kind === 'text' ? null : 'data:application/octet-stream;base64,AAAA',
      text: kind === 'text' ? '附件文字内容' : null,
    })
    const onComplete = vi.fn()
    const props = { onClose: vi.fn(), onOpenChangeComplete: onComplete }
    const view = render(<AttachmentPreviewDialog {...props} file={null} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(getAttachmentPreview).not.toHaveBeenCalled()

    view.rerender(<AttachmentPreviewDialog {...props} file={{ ...file, kind }} />)
    const popup = screen.getByRole('dialog')
    expect(popup).toHaveAttribute('data-starting-style')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    await waitFor(() => expect(popup).not.toHaveAttribute('data-starting-style'))

    view.rerender(<AttachmentPreviewDialog {...props} file={null} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onComplete).toHaveBeenCalledWith(false)
  },
)

test('images open in a large preview without displaying the filename and Escape closes', async () => {
  vi.mocked(getAttachmentPreview).mockResolvedValue({
    kind: 'image',
    source: 'data:image/png;base64,AAAA',
    text: null,
  })
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<AttachmentPreviewDialog file={file} onClose={onClose} />)
  expect(await screen.findByAltText('图片预览')).toHaveAttribute(
    'src',
    'data:image/png;base64,AAAA',
  )
  expect(screen.queryByText(file.name)).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledOnce()
})

test('videos use playback controls without autoplay and report playback errors', async () => {
  vi.mocked(getAttachmentPreview).mockResolvedValue({
    kind: 'video',
    source: 'data:video/mp4;base64,AAAA',
    text: null,
  })
  render(
    <AttachmentPreviewDialog
      file={{ ...file, kind: 'video', name: 'clip.mp4' }}
      onClose={vi.fn()}
    />,
  )
  const player = await screen.findByLabelText('视频预览', { selector: 'video' })
  expect(player).toHaveAttribute('controls')
  expect(player).not.toHaveAttribute('autoplay')
  expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument()
  fireEvent.error(player)
  expect(await screen.findByRole('alert')).toHaveTextContent('视频无法播放')
})

test('Escape closes the preview when the video player has focus', async () => {
  vi.mocked(getAttachmentPreview).mockResolvedValue({
    kind: 'video',
    source: 'data:video/mp4;base64,AAAA',
    text: null,
  })
  const onClose = vi.fn()
  render(<AttachmentPreviewDialog file={{ ...file, kind: 'video' }} onClose={onClose} />)
  const player = await screen.findByLabelText('视频预览', { selector: 'video' })
  fireEvent.keyDown(player, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
})

test('text is rendered as text and a missing source produces a visible error', async () => {
  vi.mocked(getAttachmentPreview).mockResolvedValue({
    kind: 'text',
    source: null,
    text: '<script>untrusted()</script>',
  })
  const view = render(
    <AttachmentPreviewDialog
      file={{ ...file, kind: 'text', name: 'notes.txt' }}
      onClose={vi.fn()}
    />,
  )
  expect(await screen.findByText('<script>untrusted()</script>')).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
  view.unmount()
  vi.mocked(getAttachmentPreview).mockRejectedValue(new Error('附件不存在'))
  render(<AttachmentPreviewDialog file={file} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('附件不存在'))
})
