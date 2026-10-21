import { memo } from 'react'
import { Streamdown } from 'streamdown'
import { code } from '@streamdown/code'
import type { ConversationTurnData } from './conversation-turns'
import { AttachmentList } from './attachment-list'
import { ExecutionProcess } from './execution-process'

export const ConversationTurn = memo(function ConversationTurn({
  turn,
  active,
}: {
  turn: ConversationTurnData
  active: boolean
}) {
  const { user, process, reply, lastAssistant } = turn
  const cancelled =
    lastAssistant?.status === 'cancelled' ||
    process.some((item) => item.kind === 'tool' && item.tool.status === 'cancelled')
  const error = lastAssistant?.error
  const hasAssistant = active || process.length > 0 || reply || cancelled || error

  return (
    <div className="space-y-8">
      {user && (
        <article
          aria-label="你的消息"
          className="user-message-bubble ml-auto w-fit min-w-0 max-w-[85%] space-y-3 rounded-2xl px-4 py-2.5"
        >
          <AttachmentList files={user.attachments ?? []} />
          {user.text && (
            <p className="whitespace-pre-wrap text-[15px] leading-7 wrap-anywhere">{user.text}</p>
          )}
        </article>
      )}
      {hasAssistant && (
        <article aria-label="Pi 的回复" className="space-y-3">
          {process.length > 0 && <ExecutionProcess items={process} active={active} />}
          {reply ? (
            <Streamdown
              plugins={{ code }}
              isAnimating={reply.status === 'streaming'}
              mode={reply.status === 'streaming' ? 'streaming' : 'static'}
              className="text-[15px] leading-7 wrap-anywhere"
            >
              {reply.text}
            </Streamdown>
          ) : active && process.length === 0 ? (
            <p className="text-sm text-muted-foreground">正在等待回复…</p>
          ) : null}
          {cancelled && <p className="text-xs text-muted-foreground">已停止生成</p>}
          {error && !cancelled && <p className="text-sm text-destructive">{error}</p>}
        </article>
      )}
    </div>
  )
})
