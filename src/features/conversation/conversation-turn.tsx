import { memo, useState } from 'react'
import { Streamdown } from 'streamdown'
import { code } from '@streamdown/code'
import type { ConversationTurnData } from './conversation-turns'
import { AttachmentList } from './attachment-list'
import { ExecutionProcess } from './execution-process'
import { MessageActions } from './message-actions'
import { useConversationStore } from './store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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
  const lastProcess = process.at(-1)
  const { status, instanceId, readOnly, settingsPending, rewrite } = useConversationStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canRewrite = status === 'ready' && !!instanceId && !readOnly && !settingsPending

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

  return (
    <div className="space-y-8">
      {user && (
        <article
          aria-label="你的消息"
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
                aria-label="编辑消息内容"
                autoFocus
                value={draft}
                disabled={submitting}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                className="max-h-64 rounded-none border-0 bg-transparent px-0 py-0 text-[14px] leading-6 shadow-none focus-within:ring-0 dark:bg-transparent [&_textarea]:rounded-none"
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
              <p className="whitespace-pre-wrap text-[14px] leading-6 wrap-anywhere">{user.text}</p>
            </div>
          ) : null}
          {!editing && (
            <MessageActions
              user
              text={user.text}
              timestamp={user.timestamp ?? user.startedAt}
              disabled={!canRewrite}
              onEdit={() => {
                setDraft(user.text)
                setEditing(true)
              }}
            />
          )}
        </article>
      )}
      {hasAssistant && (
        <article aria-label="Pi 的回复" className="space-y-3">
          <ExecutionProcess
            items={process}
            active={active}
            startedAt={user?.startedAt}
            finishedAt={user?.finishedAt}
          />
          <div className="space-y-2">
            {reply ? (
              <Streamdown
                plugins={{ code }}
                isAnimating={reply.status === 'streaming'}
                mode={reply.status === 'streaming' ? 'streaming' : 'static'}
                className="space-y-3 text-[14px] leading-6 wrap-anywhere"
              >
                {reply.text}
              </Streamdown>
            ) : null}
            {active && (
              <p className="text-[13px] text-muted-foreground/70">
                {lastProcess?.kind === 'tool' && lastProcess.tool.status === 'awaiting_approval'
                  ? '等待工具调用确认…'
                  : lastProcess?.kind === 'tool' && lastProcess.tool.status === 'running'
                    ? '正在执行工具…'
                    : reply?.text
                      ? '正在生成…'
                      : '正在思考…'}
              </p>
            )}
            {cancelled && <p className="text-xs text-muted-foreground">已停止生成</p>}
            {error && !cancelled && <p className="text-sm text-destructive">{error}</p>}
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
