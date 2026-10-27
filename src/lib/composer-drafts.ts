import type { Attachment } from './generated/pi'
import { sessionKey } from './session-preferences'

const prefix = 'pi-hearth.composer-draft.v1:'

export interface ComposerDraft {
  id: string
  text: string
  attachments: Attachment[]
}

export function composerDraftKey(project: string | null, sessionId?: string) {
  return sessionId ? `session:${sessionId}` : `new:${sessionKey(project) ?? 'chat'}`
}

export function emptyComposerDraft(): ComposerDraft {
  return { id: crypto.randomUUID(), text: '', attachments: [] }
}

export function loadComposerDraft(key: string): ComposerDraft {
  const source = localStorage.getItem(prefix + key)
  if (!source) return emptyComposerDraft()
  const draft = JSON.parse(source) as ComposerDraft
  if (
    typeof draft.id !== 'string' ||
    typeof draft.text !== 'string' ||
    !Array.isArray(draft.attachments) ||
    draft.attachments.length > 10 ||
    draft.attachments.some(
      (file) =>
        !file ||
        typeof file.id !== 'string' ||
        typeof file.name !== 'string' ||
        typeof file.kind !== 'string' ||
        typeof file.mimeType !== 'string' ||
        typeof file.size !== 'number',
    )
  )
    throw new Error('草稿数据无法读取。')
  return draft
}

export function saveComposerDraft(key: string, draft: ComposerDraft) {
  if (!draft.text && !draft.attachments.length) {
    localStorage.removeItem(prefix + key)
    return
  }
  // Files already have durable upload copies. Keep only their references here,
  // rather than filling WebView storage with image previews or file contents.
  localStorage.setItem(
    prefix + key,
    JSON.stringify({
      ...draft,
      attachments: draft.attachments.map(({ preview: _preview, text: _text, ...file }) => ({
        ...file,
        preview: null,
      })),
    }),
  )
}

export function removeComposerDraft(key: string) {
  localStorage.removeItem(prefix + key)
}

export function relocateComposerDrafts(relocate: (path: string) => string) {
  const keys = Object.keys(localStorage).filter((key) => key.startsWith(`${prefix}new:`))
  for (const key of keys) {
    const path = key.slice(`${prefix}new:`.length)
    const updated = `${prefix}new:${sessionKey(relocate(path))}`
    if (key === updated) continue
    const value = localStorage.getItem(key)
    if (value === null) continue
    if (localStorage.getItem(updated) !== null)
      throw new Error('项目已迁移，但新位置存在另一份草稿，原草稿已保留。')
    localStorage.setItem(updated, value)
    localStorage.removeItem(key)
  }
}

export function acceptedComposerDraft(draft: ComposerDraft, text: string, ids: string[]) {
  return {
    ...draft,
    text: draft.text.trim() === text ? '' : draft.text,
    attachments: draft.attachments.filter((file) => !ids.includes(file.id)),
  }
}

export function completeStoredComposerDraft(id: string, text: string, ids: string[]) {
  const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix))
  for (const storedKey of keys) {
    const key = storedKey.slice(prefix.length)
    let draft: ComposerDraft
    try {
      draft = loadComposerDraft(key)
    } catch {
      continue
    }
    if (draft.id === id) saveComposerDraft(key, acceptedComposerDraft(draft, text, ids))
  }
}
