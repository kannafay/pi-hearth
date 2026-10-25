import { useShallow } from 'zustand/react/shallow'
import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { ArrowUp, LoaderCircle, Paperclip, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import {
  chooseAttachments,
  clipboardAttachments,
  hasClipboardAttachments,
  listenForAttachmentDrop,
  MAX_ATTACHMENTS,
  prepareAttachmentPicker,
  releaseAttachments,
  stageFiles,
  stagePaths,
} from '@/lib/attachments'
import type { Attachment } from '@/lib/generated/pi'
import { ModelPicker } from './model-picker'
import { PermissionPicker } from './permission-picker'
import { ThinkingPicker } from './thinking-picker'
import { AttachmentList } from './attachment-list'
import { useConversationStore } from './store'
import { ConnectionNotice } from './connection-notice'
import { sessionKey } from '@/lib/session-preferences'
import { ConversationProjectPicker } from './conversation-project-picker'

export function Composer({
  onSendStart,
  onCreateProject,
}: {
  onSendStart: () => void
  onCreateProject?: () => void
}) {
  const { draft, setDraft, draftAttachments, clearAttachments, sessionActionPending } =
    useWorkspaceStore()
  const {
    status,
    sessionFile,
    runStarted,
    hasMessages,
    error,
    readOnly,
    settingsPending,
    openingSession,
    send,
    stop,
  } = useConversationStore(
    useShallow((state) => ({
      status: state.status,
      sessionFile: state.sessionFile,
      hasMessages: state.messages.length > 0,
      error: state.error,
      readOnly: state.readOnly,
      settingsPending: state.settingsPending,
      openingSession: Boolean(state.connectionTarget?.sessionPath),
      send: state.send,
      stop: state.stop,
      runStarted: Boolean(
        state.activeRunId &&
        state.messages.some((message) => message.id === `${state.activeRunId}-user`),
      ),
    })),
  )
  const [attachmentError, setAttachmentError] = useState('')
  const [pending, setPending] = useState(0)
  const [selecting, setSelecting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const nativePaste = useRef<Promise<Attachment[]> | null>(null)
  const inputArea = useRef<HTMLDivElement>(null)
  const busy = status === 'running' || status === 'stopping'
  const choosingProject = !hasMessages && !busy && !readOnly && !openingSession
  const desktop = isDesktop()
  const sessionUpdating = Boolean(
    sessionActionPending && sessionKey(sessionActionPending) === sessionKey(sessionFile),
  )

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

  async function choose() {
    if (selecting) return
    const instanceId = useConversationStore.getState().instanceId
    setSelecting(true)
    setAttachmentError('')
    try {
      const paths = await chooseAttachments()
      if (paths.length && useConversationStore.getState().instanceId === instanceId) {
        await receive(stagePaths(paths))
      }
    } catch (reason) {
      setAttachmentError(String(reason))
    } finally {
      setSelecting(false)
    }
  }

  useEffect(() => {
    if (!desktop) return
    void prepareAttachmentPicker()
    let disposed = false
    let unlisten: (() => void) | undefined
    void listenForAttachmentDrop(
      (over) =>
        setDragging(Boolean(over && inputArea.current && !inputArea.current.closest('[inert]'))),
      (paths) => {
        if (
          inputArea.current &&
          !inputArea.current.closest('[inert]') &&
          !useConversationStore.getState().readOnly
        )
          void receive(stagePaths(paths))
      },
    )
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
      {status === 'disconnected' && <ConnectionNotice className="mb-2 px-1" />}
      <div
        className="composer-project-reveal"
        data-open={choosingProject}
        aria-hidden={!choosingProject}
        inert={!choosingProject}
      >
        <div className="composer-project-clip">
          <div className="composer-project-shelf">
            <ConversationProjectPicker
              disabled={!choosingProject}
              onCreateProject={onCreateProject}
            />
          </div>
        </div>
      </div>
      <div
        ref={inputArea}
        aria-label="消息输入区"
        className={`relative z-1 overflow-hidden rounded-xl border bg-(--composer-background) pb-2 shadow-xs transition-colors focus-within:border-ring/60 ${dragging ? 'border-ring bg-muted/30' : 'border-input'}`}
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
          variant="embedded"
          aria-label="消息草稿"
          rows={1}
          placeholder={dragging ? '松开以添加附件' : '发送消息，或粘贴图片与文件…'}
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
                !sessionUpdating &&
                !selecting &&
                !pending &&
                (draft.trim() || draftAttachments.length)
              )
                void submit()
            }
          }}
          className="composer-input max-h-48 min-h-12 px-3.5 pt-3 pb-2"
        />
        <div className="flex h-7 items-stretch justify-between gap-2 px-2">
          <div className="flex h-full min-w-0 items-stretch gap-1">
            <IconButton
              label="添加附件"
              title="添加附件（也可粘贴或拖入）"
              variant="ghost"
              size="icon-sm"
              disabled={!desktop || Boolean(readOnly) || selecting || pending > 0}
              className="shrink-0 text-foreground/70"
              onClick={() => void choose()}
            >
              {pending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Paperclip className="size-4 stroke-[1.6]" />
              )}
            </IconButton>
            <PermissionPicker />
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
                sessionUpdating ||
                selecting ||
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
    </div>
  )
}
