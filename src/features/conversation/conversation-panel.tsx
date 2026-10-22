import { useEffect, useMemo, useRef } from 'react'
import { ScrollArea } from '@/components/scroll-area'
import { useConversationStore } from '@/features/conversation/store'
import { Composer } from './composer'
import { buildConversationTurns } from './conversation-turns'
import { ConversationTurn } from './conversation-turn'
import { ConversationWelcome } from './conversation-welcome'

export function ConversationPanel() {
  const { status, sessionFile, messages, tools, timeline, activity, activeRunId } =
    useConversationStore()
  const viewport = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  const turns = useMemo(
    () => buildConversationTurns(messages, tools, timeline),
    [messages, tools, timeline],
  )
  const busy = status === 'running' || status === 'stopping'

  useEffect(() => {
    if (followOutput.current && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight
    }
  }, [messages, tools, activity])

  return (
    <>
      <ScrollArea
        ref={viewport}
        role="log"
        aria-label="对话消息"
        aria-live="off"
        onScroll={() => {
          const element = viewport.current
          if (element) {
            followOutput.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 80
          }
        }}
        className="min-h-0 flex-1"
        viewportClassName="h-full overflow-x-hidden overflow-y-auto px-6 py-8"
      >
        {turns.length ? (
          <div className="mx-auto max-w-209 space-y-8">
            {turns.map((turn, index) => (
              <ConversationTurn
                key={`${sessionFile}:${turn.id}`}
                turn={turn}
                onActionStart={() => {
                  followOutput.current = true
                }}
                active={
                  busy &&
                  (turn.user?.id === `${activeRunId}-user` ||
                    turn.process.some(
                      (item) => item.kind === 'tool' && item.tool.runId === activeRunId,
                    ) ||
                    (index === turns.length - 1 && turn.lastAssistant?.status === 'streaming'))
                }
              />
            ))}
          </div>
        ) : (
          <ConversationWelcome />
        )}
      </ScrollArea>
      <Composer
        onSendStart={() => {
          followOutput.current = true
        }}
      />
    </>
  )
}
