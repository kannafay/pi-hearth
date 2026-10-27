import { memo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ChatMessage } from '@/lib/generated/pi'
import type { ConversationTurnData } from './conversation-turns'
import { AttachmentList } from './attachment-list'
import { ReplyMarkdown } from './reply-markdown'
export { ReplyMarkdown } from './reply-markdown'
import { ExecutionProcess } from './execution-process'
import { MessageActions } from './message-actions'
import { useConversationStore } from './store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useConversationLocalState } from './conversation-local-state'
import { getResponseStatus } from './response-status'
import { ResponseError } from './response-error'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/scroll-area'

function ContextSummary({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useConversationLocalState(`summary:${message.id}`, false)
  const title = message.role === 'compactionSummary' ? '上下文已压缩' : '分支上下文摘要'
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="inline-flex items-center gap-1.5 rounded-sm py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        {title}
        <ChevronRight
          aria-hidden
          className={`conversation-disclosure-chevron size-3.5 ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="execution-record-content">
        <div className="pt-3">
          <ScrollArea
            role="region"
            aria-label="上下文摘要详情"
            viewportClassName="max-h-76 overflow-x-hidden overflow-y-auto pr-3"
          >
            <ReplyMarkdown stateKey={message.id} text={message.text} streaming={false} />
          </ScrollArea>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export const ConversationTurn = memo(function ConversationTurn({
  turn,
  active,
  onActionStart,
}: {
  turn: ConversationTurnData
  active: boolean
  onActionStart: () => void
}) {
  const { user, process, reply, lastAssistant } = turn
  const cancelled =
    lastAssistant?.status === 'cancelled' ||
    process.some((item) => item.kind === 'tool' && item.tool.status === 'cancelled')
  const error = lastAssistant?.error
  const hasAssistant =
    active || process.length > 0 || reply || cancelled || error || user?.finishedAt !== undefined
  const activity = useConversationStore((state) => (active ? state.activity : ''))
  const tools = process.flatMap((item) => (item.kind === 'tool' ? [item.tool] : []))
  const unfinished =
    active && tools.some((tool) => ['queued', 'running', 'awaiting_approval'].includes(tool.status))
  const displayReply = unfinished ? null : reply
  const responseStatus = activity || getResponseStatus(lastAssistant, tools)
  // Thinking and tool activity share the process status; answer text replaces that status.
  const processStatus =
    responseStatus === '正在生成…' ||
    (displayReply?.phase === 'final_answer' && responseStatus === '等待回复…')
      ? undefined
      : responseStatus
  const rewrite = useConversationStore((state) => state.rewrite)
  const canRewrite = useConversationStore(
    (state) =>
      state.status === 'ready' && !!state.instanceId && !state.readOnly && !state.settingsPending,
  )
  const replying = useConversationStore((state) => ['running', 'stopping'].includes(state.status))
  const [editing, setEditing] = useConversationLocalState(`editing:${turn.id}`, false)
  const [draft, setDraft] = useConversationLocalState(`draft:${turn.id}`, '')
  const [submitting, setSubmitting] = useState(false)

  async function save() {
    if (!user || !canRewrite || submitting) return
    setSubmitting(true)
    onActionStart()
    try {
      if (await rewrite(user.id, draft)) setEditing(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (turn.summary) return <ContextSummary message={turn.summary} />

  return (
    <div className="space-y-8">
      {user && (
        <article
          aria-label="你的消息"
          data-conversation-message
          className={`ml-auto flex min-w-0 max-w-[85%] flex-col items-end gap-2 ${editing ? 'w-full' : 'w-fit'}`}
        >
          <AttachmentList files={user.attachments ?? []} className="justify-end" />
          {editing ? (
            <form
              className="w-full rounded-xl border border-border bg-muted/30 p-3"
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
            >
              <Textarea
                variant="embedded"
                aria-label="编辑消息内容"
                autoFocus
                value={draft}
                disabled={submitting}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                className="max-h-64 leading-6"
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'Escape' && !submitting) {
                    event.preventDefault()
                    setEditing(false)
                  }
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    void save()
                  }
                }}
              />
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <span className="mr-auto text-xs text-muted-foreground">
                  保存后从此处重新生成回复
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setEditing(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !canRewrite || submitting || (!draft.trim() && !user.attachments?.length)
                  }
                >
                  {submitting ? '正在发送…' : '保存并发送'}
                </Button>
              </div>
            </form>
          ) : user.text ? (
            <div className="user-message-bubble min-w-0 max-w-full rounded-xl px-3 py-2">
              <p className="whitespace-pre-wrap text-[14px] leading-[1.65] wrap-anywhere">
                {user.text}
              </p>
            </div>
          ) : null}
          {!editing && (
            <MessageActions
              user
              text={user.text}
              timestamp={user.timestamp ?? user.startedAt}
              disabled={!canRewrite}
              onEdit={
                replying || active
                  ? undefined
                  : () => {
                      setDraft(user.text)
                      setEditing(true)
                    }
              }
            />
          )}
        </article>
      )}
      {hasAssistant && (
        <article aria-label="Pi 的回复" data-conversation-message className="space-y-3">
          <ExecutionProcess
            stateKey={turn.id}
            items={process}
            active={active}
            startedAt={user?.startedAt}
            finishedAt={user?.finishedAt}
            status={processStatus}
          />
          <div className="space-y-2">
            {displayReply ? (
              <ReplyMarkdown
                stateKey={displayReply.id}
                text={displayReply.text}
                streaming={displayReply.status === 'streaming'}
              />
            ) : null}
            {cancelled && <p className="text-xs text-muted-foreground">已停止生成</p>}
            {error && !cancelled && !active && (
              <ResponseError key={error} error={error} stateKey={turn.id} />
            )}
            {!active && (reply || cancelled || error) && (
              <MessageActions
                text={reply?.text ?? ''}
                timestamp={lastAssistant?.timestamp ?? user?.finishedAt}
                disabled={!canRewrite}
                onRegenerate={
                  user
                    ? () => {
                        onActionStart()
                        void rewrite(user.id)
                      }
                    : undefined
                }
              />
            )}
          </div>
        </article>
      )}
    </div>
  )
})
