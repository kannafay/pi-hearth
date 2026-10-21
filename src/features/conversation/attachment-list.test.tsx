import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import type { Attachment } from '@/lib/generated/pi'
import { AttachmentList } from './attachment-list'

const image: Attachment = {
  id: 'image',
  name: 'picture.png',
  kind: 'image',
  mimeType: 'image/png',
  size: 1024,
  preview: 'data:image/png;base64,AAAA',
}
const video: Attachment = {
  id: 'video',
  name: 'clip.mp4',
  kind: 'video',
  mimeType: 'video/mp4',
  size: 2048,
  preview: null,
}

beforeEach(() => useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true))

test('media cards hide filenames and open the selected attachment with the keyboard', async () => {
  const user = userEvent.setup()
  render(<AttachmentList files={[image, video]} />)
  expect(screen.queryByText(image.name)).not.toBeInTheDocument()
  expect(screen.queryByText(video.name)).not.toBeInTheDocument()
  screen.getByRole('button', { name: '查看视频' }).focus()
  await user.keyboard('{Enter}')
  expect(useWorkspaceStore.getState().attachmentPreview).toEqual(video)
  await user.click(screen.getByRole('button', { name: '查看图片' }))
  expect(useWorkspaceStore.getState().attachmentPreview).toEqual(image)
})

test('removing an attachment does not open its preview', async () => {
  const onRemove = vi.fn()
  const user = userEvent.setup()
  render(<AttachmentList files={[image]} onRemove={onRemove} />)
  await user.click(screen.getByRole('button', { name: '移除 picture.png' }))
  expect(onRemove).toHaveBeenCalledExactlyOnceWith(image.id)
  expect(useWorkspaceStore.getState().attachmentPreview).toBeNull()
})

test('ordinary files keep a filename and a clickable view action', async () => {
  const file = { ...video, kind: 'text', name: 'notes.txt' }
  const user = userEvent.setup()
  render(<AttachmentList files={[file]} />)
  expect(screen.getByText(file.name)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '查看 notes.txt' }))
  expect(useWorkspaceStore.getState().attachmentPreview).toEqual(file)
})
