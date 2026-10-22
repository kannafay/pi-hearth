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
  const hasAssistant =
    active || process.length > 0 || reply || cancelled || error || user?.finishedAt !== undefined
  const lastProcess = process.at(-1)

  return (
    <div className="space-y-8">
      {user && (
        <article
          aria-label="你的消息"
          className="ml-auto flex w-fit min-w-0 max-w-[85%] flex-col items-end gap-3"
        >
          <AttachmentList files={user.attachments ?? []} className="justify-end" />
          {user.text && (
            <div className="user-message-bubble min-w-0 max-w-full rounded-2xl px-4 py-2.5">
              <p className="whitespace-pre-wrap text-[14px] leading-7 wrap-anywhere">{user.text}</p>
            </div>
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
        </article>
      )}
    </div>
  )
})
