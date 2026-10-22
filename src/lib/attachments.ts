import { invoke } from '@tauri-apps/api/core'
import { dirname, downloadDir, homeDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import type { Attachment, AttachmentPreview } from './generated/pi'

export const MAX_ATTACHMENTS = 10
const MAX_FILE_SIZE = 20 * 1024 * 1024
let pickerDirectory: Promise<string | undefined> | undefined

export function prepareAttachmentPicker() {
  // Resolve this before the click, and avoid starting in Windows Home/Recent.
  return (pickerDirectory ??= downloadDir()
    .catch(() => homeDir())
    .catch(() => undefined))
}

export async function getAttachmentPreview(file: Attachment): Promise<AttachmentPreview> {
  if (file.text !== undefined) return { kind: 'text', source: null, text: file.text }
  if (file.sourcePath) {
    try {
      return await invoke<AttachmentPreview>('attachment_preview', { path: file.sourcePath })
    } catch (reason) {
      if (file.kind !== 'image' || !file.preview) throw reason
    }
  }
  if (file.kind === 'image' && file.preview) {
    return { kind: 'image', source: file.preview, text: null }
  }
  throw new Error('附件源文件不可用，请重新添加。')
}

export async function chooseAttachments() {
  const defaultPath = await prepareAttachmentPicker()
  const selected = await open({ multiple: true, directory: false, title: '添加附件', defaultPath })
  const paths = selected ? (Array.isArray(selected) ? selected : [selected]) : []
  if (paths.length) pickerDirectory = dirname(paths[0]).catch(() => defaultPath)
  return paths
}

export function stagePaths(paths: string[]) {
  return invoke<Attachment[]>('attachment_paths', { paths })
}

export async function stageFiles(files: File[]) {
  if (files.length > MAX_ATTACHMENTS) throw new Error('每条消息最多添加 10 个附件。')
  const added: Attachment[] = []
  try {
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) throw new Error('单个附件不能超过 20 MiB。')
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(new Error(`无法读取 ${file.name}。`))
        reader.readAsDataURL(file)
      })
      added.push(...(await invoke<Attachment[]>('attachment_bytes', { name: file.name, data })))
    }
    return added
  } catch (error) {
    releaseAttachments(added.map((file) => file.id))
    throw error
  }
}

export function clipboardAttachments() {
  return invoke<Attachment[]>('attachment_clipboard')
}

export function hasClipboardAttachments() {
  return invoke<boolean>('attachment_clipboard_available')
}

export function releaseAttachments(ids: string[]) {
  if (ids.length) void invoke('attachment_release', { ids }).catch(() => {})
}

export async function listenForAttachmentDrop(
  onOver: (over: boolean) => void,
  onDrop: (paths: string[]) => void,
) {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    onOver(payload.type === 'enter' || payload.type === 'over')
    if (payload.type === 'drop') onDrop(payload.paths)
  })
}
