import { useEffect, useState } from 'react'
import { Brain, ChevronRight, MessageSquareText } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ProcessItem } from './conversation-turns'
import { ToolRecord } from './tool-record'
import { useConversationLocalState } from './conversation-local-state'
import { useExecutionRecord } from './use-execution-record'
import { ExecutionRecord } from './execution-record'

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

function ProcessTextRecord({
  item,
  stateKey,
  active,
}: {
  item: Exclude<ProcessItem, { kind: 'tool' }>
  stateKey?: string
  active: boolean
}) {
  const [open, setOpen, headerRef] = useExecutionRecord(
    `${item.kind}:${stateKey ?? ''}:${item.id}:expanded`,
    false,
  )
  return (
    <ExecutionRecord
      icon={item.kind === 'thinking' ? Brain : MessageSquareText}
      title={item.kind === 'thinking' ? '思考' : '执行说明'}
      open={open}
      onOpenChange={setOpen}
      headerRef={headerRef}
      follow={active}
    >
      <div className="space-y-1.5">
        {(item.kind === 'thinking' ? item.text : item.message.text)
          .split(/\n\s*\n/)
          .map((paragraph, index) => (
            <p key={index} className="whitespace-pre-wrap">
              {paragraph}
            </p>
          ))}
      </div>
    </ExecutionRecord>
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
  const tools = items.flatMap((item) => (item.kind === 'tool' ? [item.tool] : []))
  const awaiting = tools.some((tool) => tool.status === 'awaiting_approval')
  // A manual choice applies to this phase only; finishing always collapses the process.
  const open = awaiting || (choice?.active === active ? choice.open : active)
  const failures = tools.filter((tool) => tool.status === 'failed').length
  const elapsed =
    startedAt !== undefined && finishedAt !== undefined
      ? Math.max(0, finishedAt - startedAt)
      : undefined

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
            className="conversation-disclosure-chevron size-3.5 shrink-0 in-data-panel-open:rotate-90"
          />
        )}
        {awaiting ? (
          <span className="text-xs text-foreground">等待确认</span>
        ) : failures > 0 ? (
          <span className="text-xs text-destructive">{failures} 次失败</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="execution-process-content">
        <div role="region" aria-label="执行过程详情" className="mt-1 space-y-1">
          {items.map((item) =>
            item.kind === 'tool' ? (
              <ToolRecord key={item.id} tool={item.tool} />
            ) : (
              <ProcessTextRecord
                key={item.id}
                item={item}
                stateKey={stateKey}
                active={active && item === items.at(-1)}
              />
            ),
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
