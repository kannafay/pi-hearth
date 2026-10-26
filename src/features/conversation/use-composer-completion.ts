import { useEffect, useId, useState, type KeyboardEvent, type RefObject } from 'react'
import { isDesktop } from '@/lib/desktop'
import { loadComposerCommands, searchProjectFiles } from '@/lib/composer'
import type { ComposerCommand } from '@/lib/generated/pi'
import {
  commandItems,
  completionQuery,
  insertCompletion,
  type CompletionItem,
} from './composer-completion'

export function useComposerCompletion({
  draft,
  setDraft,
  instanceId,
  enabled,
  input,
}: {
  draft: string
  setDraft: (value: string) => void
  instanceId: string | null
  enabled: boolean
  input: RefObject<HTMLTextAreaElement | null>
}) {
  const id = useId()
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [focused, setFocused] = useState(false)
  const [revision, setRevision] = useState(0)
  const [dismissed, setDismissed] = useState('')
  const [highlight, setHighlight] = useState({ key: '', index: 0 })
  const [result, setResult] = useState<{
    key: string
    skills: ComposerCommand[]
    paths: string[]
    error: string | null
  } | null>(null)
  const query = enabled && focused ? completionQuery(draft, selection.start, selection.end) : null
  const key = query
    ? JSON.stringify([instanceId, query.kind, query.query, query.start, query.end, revision])
    : ''
  const open = Boolean(query && key !== dismissed)
  const kind = query?.kind
  const term = query?.query
  const current = result?.key === key
  const loading = open && Boolean(instanceId) && isDesktop() && !current
  const error = current ? result?.error : null
  const items: CompletionItem[] =
    !open || !query
      ? []
      : query.kind === 'command'
        ? commandItems(current ? result.skills : [], query.query)
        : current
          ? result.paths.map((path) => ({
              value: path,
              label: path.split('/').at(-1) ?? path,
              description: path,
              kind: 'file' as const,
            }))
          : []
  const active =
    highlight.key === key ? Math.min(highlight.index, Math.max(0, items.length - 1)) : 0

  useEffect(() => {
    if (!open || !kind || term === undefined || !instanceId || !isDesktop()) return
    let disposed = false
    const timer = setTimeout(
      () => {
        const request =
          kind === 'command'
            ? loadComposerCommands(instanceId).then((skills) => ({ skills, paths: [] as string[] }))
            : searchProjectFiles(instanceId, term).then((paths) => ({
                skills: [] as ComposerCommand[],
                paths,
              }))
        void request.then(
          (data) => {
            if (!disposed) setResult({ key, ...data, error: null })
          },
          (reason) => {
            if (!disposed) setResult({ key, skills: [], paths: [], error: String(reason) })
          },
        )
      },
      kind === 'file' ? 150 : 80,
    )
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [open, key, instanceId, kind, term])

  function select(item: CompletionItem) {
    if (!query) return
    const inserted = insertCompletion(draft, query, item.value)
    setDraft(inserted.text)
    setDismissed(key)
    setSelection({ start: inserted.caret, end: inserted.caret })
    requestAnimationFrame(() => {
      if (
        !input.current?.isConnected ||
        input.current.closest('[inert]') ||
        input.current.value !== inserted.text
      )
        return
      input.current.focus({ preventScroll: true })
      input.current.setSelectionRange(inserted.caret, inserted.caret)
    })
  }

  return {
    id,
    open,
    items,
    active,
    loading,
    error,
    kind: query?.kind,
    setActive: (index: number) => setHighlight({ key, index }),
    select,
    retry: () => setRevision((value) => value + 1),
    close: () => setDismissed(key),
    updateSelection: (target: HTMLTextAreaElement) =>
      setSelection({ start: target.selectionStart, end: target.selectionEnd }),
    edit: (target: HTMLTextAreaElement) => {
      setDismissed('')
      setSelection({ start: target.selectionStart, end: target.selectionEnd })
    },
    focus: () => {
      setFocused(true)
      setRevision((value) => value + 1)
    },
    blur: () => setFocused(false),
    onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (
        !open ||
        event.nativeEvent.isComposing ||
        event.nativeEvent.keyCode === 229 ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return false
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDismissed(key)
        return true
      }
      if (items.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault()
        setHighlight({
          key,
          index: (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length,
        })
        return true
      }
      if (event.key === 'Enter' || (event.key === 'Tab' && items.length > 0)) {
        event.preventDefault()
        if (items[active]) select(items[active])
        return true
      }
      return false
    },
  }
}

export type ComposerCompletion = ReturnType<typeof useComposerCompletion>
