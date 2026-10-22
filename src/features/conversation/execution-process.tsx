import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ProcessItem } from './conversation-turns'
import { ToolRecord } from './tool-record'
import { ScrollArea } from '@/components/scroll-area'

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
      {active ? '已处理 ' : '用时 '}
      {formatElapsed((active ? now : finishedAt!) - startedAt)}
    </span>
  )
}

export function ExecutionProcess({
  items,
  active,
  startedAt,
  finishedAt,
}: {
  items: ProcessItem[]
  active: boolean
  startedAt?: number
  finishedAt?: number
}) {
  const [choice, setChoice] = useState<{ active: boolean; open: boolean } | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const tools = items.flatMap((item) => (item.kind === 'tool' ? [item.tool] : []))
  const awaiting = tools.some((tool) => tool.status === 'awaiting_approval')
  // A manual choice applies to this phase only; finishing always collapses the process.
  const open = awaiting || (choice?.active === active ? choice.open : active)
  const failures = tools.filter((tool) => tool.status === 'failed').length

  useEffect(() => {
    if (open && (active || awaiting) && (follow.current || awaiting) && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight
    }
  }, [items, active, awaiting, open])

  return (
    <Collapsible open={open} onOpenChange={(open) => setChoice({ active, open })}>
      <CollapsibleTrigger
        aria-label="执行过程"
        disabled={awaiting || !items.length}
        className="flex w-full items-center gap-2 border-b border-border/60 pt-1 pb-3 text-left text-[14px] text-muted-foreground outline-none enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <ElapsedTime active={active} startedAt={startedAt} finishedAt={finishedAt} />
        {items.length > 0 && (
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 transition-transform in-data-panel-open:rotate-90"
          />
        )}
        {awaiting ? (
          <span className="text-xs text-foreground">等待确认</span>
        ) : failures > 0 ? (
          <span className="text-xs text-destructive">{failures} 次失败</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ScrollArea
          ref={viewport}
          role="region"
          aria-label="执行过程详情"
          className="mt-3"
          viewportClassName="max-h-80 space-y-3 overflow-x-hidden overflow-y-auto"
          onScroll={() => {
            const element = viewport.current
            if (element)
              follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
          }}
        >
          {items.map((item) =>
            item.kind === 'tool' ? (
              <ToolRecord key={item.id} tool={item.tool} compact />
            ) : item.kind === 'thinking' ? (
              <div key={item.id} className="px-2 py-1">
                <p className="mb-1 text-xs text-muted-foreground">思考</p>
                <p className="text-[13px] leading-6 whitespace-pre-wrap text-muted-foreground wrap-anywhere">
                  {item.text}
                </p>
              </div>
            ) : (
              <p
                key={item.id}
                className="px-2 py-1 text-[13px] leading-6 whitespace-pre-wrap text-muted-foreground wrap-anywhere"
              >
                {item.message.text}
              </p>
            ),
          )}
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  )
}
