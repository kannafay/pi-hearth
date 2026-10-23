import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ProcessItem } from './conversation-turns'
import { ToolRecord } from './tool-record'
import { ScrollArea } from '@/components/scroll-area'
import { useConversationLocalState } from './conversation-local-state'

export function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours ? `${hours}小时` : ''}${minutes ? `${minutes}分` : ''}${seconds % 60}秒`
}

function ElapsedTime({
  active,
  startedAt,
  finishedAt,
}: {
  active: boolean
  startedAt?: number
  finishedAt?: number
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  if (startedAt === undefined || (!active && finishedAt === undefined))
    return <span>{active ? '正在处理…' : '已完成'}</span>
  return (
    <span>
      {active ? '已用时 ' : '用时 '}
      {formatElapsed((active ? now : finishedAt!) - startedAt)}
    </span>
  )
}

export function ExecutionProcess({
  stateKey,
  items,
  active,
  startedAt,
  finishedAt,
}: {
  stateKey?: string
  items: ProcessItem[]
  active: boolean
  startedAt?: number
  finishedAt?: number
}) {
  const [choice, setChoice] = useConversationLocalState<{ active: boolean; open: boolean } | null>(
    stateKey ? `process:${stateKey}` : undefined,
    null,
  )
  const viewport = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const tools = items.flatMap((item) => (item.kind === 'tool' ? [item.tool] : []))
  const awaiting = tools.some((tool) => tool.status === 'awaiting_approval')
  // A manual choice applies to this phase only; finishing always collapses the process.
  const open = awaiting || (choice?.active === active ? choice.open : active)
  const failures = tools.filter((tool) => tool.status === 'failed').length
  const elapsed =
    startedAt !== undefined && finishedAt !== undefined
      ? Math.max(0, finishedAt - startedAt)
      : undefined

  useEffect(() => {
    if (open && (active || awaiting) && (follow.current || awaiting) && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight
    }
  }, [items, active, awaiting, open])

  if (!active && !items.length && elapsed !== undefined && elapsed <= 2000) return null

  return (
    <Collapsible open={open} onOpenChange={(open) => setChoice({ active, open })}>
      <CollapsibleTrigger
        aria-label="执行过程"
        disabled={awaiting || !items.length}
        className="flex w-full items-center gap-2 border-b border-border/60 pt-1 pb-2 text-left text-[14px] text-muted-foreground transition-colors duration-160 ease-out outline-none enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <ElapsedTime active={active} startedAt={startedAt} finishedAt={finishedAt} />
        {items.length > 0 && (
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 transition-transform duration-160 ease-out in-data-panel-open:rotate-90"
          />
        )}
        {awaiting ? (
          <span className="text-xs text-foreground">等待确认</span>
        ) : failures > 0 ? (
          <span className="text-xs text-destructive">{failures} 次失败</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="execution-process-content">
        <ScrollArea
          ref={viewport}
          role="region"
          aria-label="执行过程详情"
          className="mt-3"
          viewportClassName="max-h-80 overflow-x-hidden overflow-y-auto pr-2"
          onScroll={() => {
            const element = viewport.current
            if (element)
              follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
          }}
        >
          <div className="space-y-4">
            {items.map((item) =>
              item.kind === 'tool' ? (
                <ToolRecord key={item.id} tool={item.tool} compact />
              ) : item.kind === 'thinking' ? (
                <div key={item.id} className="space-y-2 pr-1">
                  <p className="flex items-center gap-1.5 text-[14px] font-medium text-foreground/65">
                    <Brain aria-hidden className="size-3.5 stroke-[1.6]" />
                    思考
                  </p>
                  <div className="space-y-2 text-[14px] leading-[1.65] text-muted-foreground wrap-anywhere">
                    {item.text.split(/\n\s*\n/).map((paragraph, index) => (
                      <p key={index} className="whitespace-pre-wrap">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <p
                  key={item.id}
                  className="pr-1 text-[13px] leading-[1.65] whitespace-pre-wrap text-muted-foreground wrap-anywhere"
                >
                  {item.message.text}
                </p>
              ),
            )}
          </div>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  )
}
