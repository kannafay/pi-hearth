import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { ArrowUp, LoaderCircle, Paperclip, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import {
  chooseAttachments,
  clipboardAttachments,
  hasClipboardAttachments,
  listenForAttachmentDrop,
  MAX_ATTACHMENTS,
  releaseAttachments,
  stageFiles,
  stagePaths,
} from '@/lib/attachments'
import type { Attachment } from '@/lib/generated/pi'
import { ModelPicker } from './model-picker'
import { ThinkingPicker } from './thinking-picker'
import { AttachmentList } from './attachment-list'
import { useConversationStore } from './store'
import { ConnectionNotice } from './connection-notice'

export function Composer({ onSendStart }: { onSendStart: () => void }) {
  const { draft, setDraft, draftAttachments, clearAttachments } = useWorkspaceStore()
  const {
    status,
    messages,
    activeRunId,
    error,
    readOnly,
    settingsPending,
    activity,
    model,
    send,
    stop,
  } = useConversationStore()
  const [attachmentError, setAttachmentError] = useState('')
  const [pending, setPending] = useState(0)
  const [dragging, setDragging] = useState(false)
  const nativePaste = useRef<Promise<Attachment[]> | null>(null)
  const busy = status === 'running' || status === 'stopping'
  const runStarted = messages.some((message) => message.id === `${activeRunId}-user`)
  const desktop = isDesktop()
  const connecting = status === 'connecting' || status === 'disconnected'
  const statusText = connecting ? '' : activity || (!model ? '请配置模型' : '')

  async function receive(request: Promise<Attachment[]>) {
    const instanceId = useConversationStore.getState().instanceId
    setPending((count) => count + 1)
    setAttachmentError('')
    try {
      const files = await request
      if (useConversationStore.getState().instanceId !== instanceId) {
        releaseAttachments(files.map((file) => file.id))
        return []
      }
      if (useWorkspaceStore.getState().draftAttachments.length + files.length > MAX_ATTACHMENTS) {
        releaseAttachments(files.map((file) => file.id))
        throw new Error('每条消息最多添加 10 个附件。')
      }
      useWorkspaceStore.getState().addAttachments(files)
      return files
    } catch (reason) {
      setAttachmentError(String(reason))
      return []
    } finally {
      setPending((count) => count - 1)
    }
  }

  useEffect(() => {
    if (!desktop) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void listenForAttachmentDrop(setDragging, (paths) => {
      if (!useConversationStore.getState().readOnly) void receive(stagePaths(paths))
    })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => {})
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [desktop])

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files)
    if (files.length) {
      event.preventDefault()
      const attempt = nativePaste.current
      void (async () => {
        if (attempt && (await attempt).length) return
        await receive(stageFiles(files))
      })()
    } else if (
      !event.clipboardData.getData('text/plain') &&
      !event.clipboardData.getData('text/html') &&
      desktop
    ) {
      event.preventDefault()
      if (!nativePaste.current) void receive(clipboardAttachments())
    }
  }

  async function submit() {
    if (nativePaste.current) await nativePaste.current
    const latest = useWorkspaceStore.getState()
    const text = latest.draft.trim()
    const ids = latest.draftAttachments.map((file) => file.id)
    onSendStart()
    if (await send(text, ids)) {
      if (useWorkspaceStore.getState().draft.trim() === text) setDraft('')
      clearAttachments(ids)
    }
  }

  return (
    <div className="mx-auto w-full max-w-221 shrink-0 px-6 pt-3 pb-3">
      {(error || attachmentError) && (
        <p role="alert" className="mb-3 text-xs leading-6 text-destructive">
          {attachmentError || error}
        </p>
      )}
      {readOnly && (
        <p role="status" className="mb-3 text-xs text-muted-foreground">
          {readOnly}
        </p>
      )}
      <div
        aria-label="消息输入区"
        className={`relative overflow-hidden rounded-xl border bg-background pb-2 shadow-xs transition-colors focus-within:border-ring/60 ${dragging ? 'border-ring bg-muted/30' : 'border-input'}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (event.dataTransfer.files.length && !readOnly)
            void receive(stageFiles(Array.from(event.dataTransfer.files)))
        }}
      >
        {draftAttachments.length > 0 && (
          <div className="px-3 pt-3">
            <AttachmentList files={draftAttachments} onRemove={(id) => clearAttachments([id])} />
          </div>
        )}
        <Textarea
          aria-label="消息草稿"
          rows={1}
          placeholder={
            dragging
              ? '松开以添加附件'
              : status === 'connecting'
                ? '可以先输入，连接完成后发送…'
                : '发送消息，或粘贴图片与文件…'
          }
          value={draft}
          disabled={Boolean(readOnly)}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={paste}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === 'v' &&
              desktop &&
              !readOnly
            ) {
              // Inspect formats without entering the attachment loading state for text.
              const request = hasClipboardAttachments()
                .then((available) => (available ? receive(clipboardAttachments()) : []))
                .catch(() => [])
              nativePaste.current = request
              void request.finally(() =>
                setTimeout(() => {
                  if (nativePaste.current === request) nativePaste.current = null
                }, 250),
              )
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (
                status === 'ready' &&
                !settingsPending &&
                !pending &&
                (draft.trim() || draftAttachments.length)
              )
                void submit()
            }
          }}
          className="composer-input max-h-48 min-h-12 rounded-none border-0 bg-transparent px-3.5 pt-3 pb-2 text-sm shadow-none focus-within:border-transparent focus-within:ring-0 dark:bg-transparent"
        />
        <div className="flex h-7 items-stretch justify-between gap-2 px-2">
          <div className="flex h-full min-w-0 items-stretch gap-1">
            <Button
              aria-label="添加附件"
              title="添加附件（也可粘贴或拖入）"
              variant="ghost"
              size="icon-sm"
              disabled={!desktop || Boolean(readOnly) || pending > 0}
              className="shrink-0 text-foreground/70"
              onClick={() => void receive(chooseAttachments())}
            >
              {pending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Paperclip className="size-4 stroke-[1.6]" />
              )}
            </Button>
            <ModelPicker compact />
            <ThinkingPicker />
          </div>
          {busy ? (
            <Button
              aria-label="停止生成"
              size="icon-sm"
              variant="secondary"
              disabled={status === 'stopping' || !runStarted}
              onClick={() => void stop()}
            >
              {status === 'stopping' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Square className="size-3 fill-current" />
              )}
            </Button>
          ) : (
            <Button
              aria-label="发送消息"
              size="icon-sm"
              disabled={
                status !== 'ready' ||
                Boolean(readOnly) ||
                Boolean(settingsPending) ||
                pending > 0 ||
                (!draft.trim() && !draftAttachments.length)
              }
              onClick={() => void submit()}
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
      {connecting && messages.length > 0 ? (
        <ConnectionNotice className="mt-2 px-1" />
      ) : statusText ? (
        <p role="status" className="mt-2 truncate px-1 text-[11px] text-muted-foreground/80">
          {statusText}
        </p>
      ) : null}
    </div>
  )
}
