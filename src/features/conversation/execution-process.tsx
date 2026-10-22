import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronRight, Clock, LoaderCircle, Terminal } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ProcessItem } from './conversation-turns'
import { ToolRecord } from './tool-record'
import { ScrollArea } from '@/components/scroll-area'
import { cn } from '@/lib/utils'

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
    <span className="tabular-nums">
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
  const hasDetails = items.length > 0
  const Icon = active
    ? LoaderCircle
    : items.some((item) => item.kind === 'thinking')
      ? Brain
      : tools.length
        ? Terminal
        : Clock
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
    <Collapsible
      open={open}
      onOpenChange={(open) => setChoice({ active, open })}
      className={cn(
        'min-w-0',
        hasDetails && 'overflow-hidden rounded-xl border border-border/60 bg-muted/20',
      )}
    >
      <CollapsibleTrigger
        aria-label="执行过程"
        disabled={awaiting || !items.length}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 text-left text-[14px] text-muted-foreground transition-colors duration-160 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default',
          hasDetails ? 'px-3 py-2 enabled:hover:bg-muted/45 enabled:hover:text-foreground' : 'py-1',
        )}
      >
        <Icon
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 stroke-[1.6]',
            active && 'animate-spin motion-reduce:animate-none',
          )}
        />
        <ElapsedTime active={active} startedAt={startedAt} finishedAt={finishedAt} />
        {tools.length > 0 && (
          <span className="hidden text-xs text-muted-foreground/75 sm:inline">
            {tools.length} 次工具调用
          </span>
        )}
        <span className="min-w-0 flex-1" />
        {awaiting ? (
          <span className="rounded-md bg-background/80 px-1.5 py-0.5 text-xs text-foreground">
            等待确认
          </span>
        ) : failures > 0 ? (
          <span className="text-xs text-destructive">{failures} 次失败</span>
        ) : null}
        {hasDetails && (
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 transition-transform duration-160 ease-out in-data-panel-open:rotate-90"
          />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="execution-process-content">
        <ScrollArea
          ref={viewport}
          role="region"
          aria-label="执行过程详情"
          className="border-t border-border/50 px-3 py-3"
          viewportClassName="max-h-72 overflow-x-hidden overflow-y-auto pr-2"
          onScroll={() => {
            const element = viewport.current
            if (element)
              follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
          }}
        >
          <div className="ml-1.5 space-y-4 border-l border-border/70 pl-3">
            {items.map((item) =>
              item.kind === 'tool' ? (
                <ToolRecord key={item.id} tool={item.tool} compact />
              ) : item.kind === 'thinking' ? (
                <div key={item.id} className="space-y-2 px-1">
                  <p className="text-xs font-medium text-foreground/65">思考</p>
                  <div className="space-y-2 text-[13px] leading-[1.65] text-muted-foreground wrap-anywhere">
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
                  className="px-1 text-[13px] leading-[1.65] whitespace-pre-wrap text-muted-foreground wrap-anywhere"
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
