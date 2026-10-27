import { useShallow } from 'zustand/react/shallow'
import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react'
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
import { executeComposerCommand, type ComposerActions } from './composer-commands'
import { useComposerCompletion } from './use-composer-completion'
import { ComposerCompletionMenu } from './composer-completion-menu'
import { slashCommand } from './composer-completion'
import { toast } from '@/lib/toast'
import { ContextUsageIndicator } from './context-usage'

export function Composer({
  onSendStart,
  onCreateProject,
  onSettings,
  onResume,
  onRename,
}: {
  onSendStart: () => void
  onCreateProject?: () => void
} & ComposerActions) {
  const {
    draft,
    setDraft,
    draftAttachments,
    draftRestoring,
    clearAttachments,
    sessionActionPending,
  } = useWorkspaceStore()
  const {
    status,
    instanceId,
    activity,
    sessionFile,
    runStarted,
    hasMessages,
    readOnly,
    settingsPending,
    openingSession,
    send,
    stop,
  } = useConversationStore(
    useShallow((state) => ({
      status: state.status,
      instanceId: state.instanceId,
      activity: state.activity,
      sessionFile: state.sessionFile,
      hasMessages: state.messages.length > 0,
      readOnly: state.readOnly,
      settingsPending: state.settingsPending,
      openingSession: Boolean(state.connectionTarget?.sessionPath),
      send: state.send,
      stop: state.stop,
      runStarted: Boolean(
        state.activeRunId &&
        (state.activity === '正在压缩上下文…' ||
          state.messages.some((message) => message.id === `${state.activeRunId}-user`)),
      ),
    })),
  )
  const [pending, setPending] = useState(0)
  const [selecting, setSelecting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [commandInstance, setCommandInstance] = useState<string | null>(null)
  const commandBusy = Boolean(instanceId && commandInstance === instanceId)
  const [pickerState, setPickerState] = useState<{
    instanceId: string | null
    value: 'model' | 'thinking' | null
  }>({ instanceId, value: null })
  const picker = pickerState.instanceId === instanceId ? pickerState.value : null
  const setPicker = (value: 'model' | 'thinking' | null) => setPickerState({ instanceId, value })
  const submitting = useRef<{ instanceId: string | null; token: symbol } | null>(null)
  const draftInput = useRef<HTMLTextAreaElement>(null)
  const nativePaste = useRef<Promise<Attachment[]> | null>(null)
  const inputArea = useRef<HTMLDivElement>(null)
  const busy = status === 'running' || status === 'stopping'
  const choosingProject = !hasMessages && !busy && !readOnly && !openingSession
  const desktop = isDesktop()
  const sessionUpdating = Boolean(
    sessionActionPending && sessionKey(sessionActionPending) === sessionKey(sessionFile),
  )
  const completion = useComposerCompletion({
    draft,
    setDraft,
    instanceId,
    input: draftInput,
    enabled:
      status === 'ready' && !readOnly && !settingsPending && !sessionUpdating && !commandBusy,
  })

  const receive = useCallback(async (request: Promise<Attachment[]>) => {
    const instanceId = useConversationStore.getState().instanceId
    setPending((count) => count + 1)
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
      if (useConversationStore.getState().instanceId === instanceId) toast.error(reason)
      return []
    } finally {
      setPending((count) => count - 1)
    }
  }, [])

  async function choose() {
    if (selecting) return
    const instanceId = useConversationStore.getState().instanceId
    setSelecting(true)
    try {
      const paths = await chooseAttachments()
      if (paths.length && useConversationStore.getState().instanceId === instanceId) {
        await receive(stagePaths(paths))
      }
    } catch (reason) {
      if (useConversationStore.getState().instanceId === instanceId) toast.error(reason)
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
  }, [desktop, receive])

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
    const submittedInstance = useConversationStore.getState().instanceId
    if (submitting.current?.instanceId === submittedInstance) return
    const attempt = Symbol()
    submitting.current = { instanceId: submittedInstance, token: attempt }
    try {
      if (nativePaste.current) await nativePaste.current
      if (useConversationStore.getState().instanceId !== submittedInstance) return
      if (
        useWorkspaceStore.getState().draftNeedsRestore &&
        !(await useWorkspaceStore.getState().restoreDraftAttachments())
      )
        return
      if (useConversationStore.getState().instanceId !== submittedInstance) return
      const latest = useWorkspaceStore.getState()
      const text = latest.draft.trim()
      const ids = latest.draftAttachments.map((file) => file.id)
      const instanceId = useConversationStore.getState().instanceId
      const state = useConversationStore.getState()
      if (
        state.status !== 'ready' ||
        state.readOnly ||
        state.settingsPending ||
        pending ||
        selecting ||
        sessionUpdating
      )
        return
      setCommandInstance(submittedInstance)
      const command = slashCommand(text)
        ? await executeComposerCommand(text, ids.length, {
            onSettings,
            onResume,
            onRename,
            onPicker: setPicker,
          })
        : null
      if (useConversationStore.getState().instanceId !== instanceId) return
      if (command === null) onSendStart()
      if (command === true || (command === null && (await send(text, ids)))) {
        if (latest.draftKey) {
          useWorkspaceStore.getState().completeDraft(latest.draftId, text, ids)
          return
        }
        if (
          useConversationStore.getState().instanceId === instanceId &&
          useWorkspaceStore.getState().draft.trim() === text
        )
          setDraft('')
        clearAttachments(ids)
      }
    } catch (reason) {
      if (useConversationStore.getState().instanceId === submittedInstance) toast.error(reason)
    } finally {
      if (submitting.current?.token === attempt) {
        submitting.current = null
        setCommandInstance(null)
      }
    }
  }

  return (
    <div className="mx-auto w-full max-w-221 shrink-0 px-6 pt-3 pb-3">
      {readOnly && (
        <p role="status" className="mb-3 text-xs text-muted-foreground">
          {readOnly}
        </p>
      )}
      {status === 'disconnected' && <ConnectionNotice className="mb-2 px-1" />}
      {busy && activity === '正在压缩上下文…' && (
        <p
          role="status"
          className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground"
        >
          <LoaderCircle aria-hidden className="size-3 animate-spin" />
          {activity}
        </p>
      )}
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
      <div className="relative">
        <ComposerCompletionMenu completion={completion} />
        <div
          ref={inputArea}
          aria-label="消息输入区"
          className={`relative z-1 overflow-hidden rounded-xl border bg-(--composer-background) pb-2 shadow-xs transition-colors focus-within:border-ring/60 ${dragging ? 'border-ring bg-muted/30' : 'border-input'}`}
          onPointerDown={(event) => {
            if (event.button !== 0 || event.defaultPrevented || readOnly) return
            const target = event.target
            if (
              !(target instanceof Element) ||
              !event.currentTarget.contains(target) ||
              target.closest(
                'button, a, input, textarea, select, [role="button"], [role="combobox"], [contenteditable], .os-scrollbar',
              )
            )
              return
            event.preventDefault()
            event.currentTarget.querySelector('textarea')?.focus({ preventScroll: true })
          }}
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
            ref={draftInput}
            variant="embedded"
            aria-label="消息草稿"
            rows={1}
            placeholder={dragging ? '松开以添加附件' : '发送消息，输入 / 使用命令，@ 引用文件…'}
            value={draft}
            disabled={Boolean(readOnly)}
            aria-autocomplete="list"
            aria-expanded={completion.open}
            aria-controls={completion.open ? completion.id : undefined}
            aria-activedescendant={
              completion.open && completion.items[completion.active]
                ? `${completion.id}-${completion.active}`
                : undefined
            }
            onChange={(event) => {
              setDraft(event.target.value)
              completion.edit(event.target)
            }}
            onSelect={(event) => completion.updateSelection(event.currentTarget)}
            onFocus={(event) => {
              completion.focus()
              completion.updateSelection(event.target)
            }}
            onBlur={completion.blur}
            onPaste={paste}
            onKeyDown={(event) => {
              if (completion.onKeyDown(event)) return
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
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault()
                if (
                  status === 'ready' &&
                  !settingsPending &&
                  !commandBusy &&
                  !sessionUpdating &&
                  !selecting &&
                  !pending &&
                  !draftRestoring &&
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
                disabled={
                  !desktop || Boolean(readOnly) || selecting || pending > 0 || draftRestoring
                }
                className="shrink-0 text-foreground/70"
                onClick={() => void choose()}
              >
                {pending || draftRestoring ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Paperclip className="size-4 stroke-[1.6]" />
                )}
              </IconButton>
              <PermissionPicker />
              <ModelPicker
                compact
                open={picker === 'model'}
                onOpenChange={(open) => setPicker(open ? 'model' : null)}
              />
              <ThinkingPicker
                open={picker === 'thinking'}
                onOpenChange={(open) => setPicker(open ? 'thinking' : null)}
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ContextUsageIndicator />
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
                    commandBusy ||
                    sessionUpdating ||
                    selecting ||
                    pending > 0 ||
                    draftRestoring ||
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
      </div>
    </div>
  )
}
