import { memo, startTransition, useEffect, useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ProcessItem } from './conversation-turns'
import { ToolRecord } from './tool-record'
import { useConversationLocalState } from './conversation-local-state'
import { useExecutionRecord } from './use-execution-record'
import { ExecutionRecord } from './execution-record'
import { ReplyMarkdown } from './reply-markdown'
import { ResponseWaiting } from './response-waiting'

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

function ProcessTextContent({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      {text.split(/\n\s*\n/).map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap">
          {paragraph}
        </p>
      ))}
    </div>
  )
}

const ProcessTextRecord = memo(function ProcessTextRecord({
  id,
  text,
  stateKey,
}: {
  id: string
  text: string
  stateKey?: string
}) {
  const [open, setOpen, headerRef] = useExecutionRecord(
    `thinking:${stateKey ?? ''}:${id}:expanded`,
    'finished',
  )
  return (
    <ExecutionRecord
      icon={Brain}
      title="思考"
      open={open}
      onOpenChange={setOpen}
      headerRef={headerRef}
    >
      <ProcessTextContent text={text} />
    </ExecutionRecord>
  )
})

const ProcessRecords = memo(function ProcessRecords({
  items,
  stateKey,
}: {
  items: ProcessItem[]
  stateKey?: string
}) {
  // Keep the top gap inside the animated height so unmounting cannot shift the reply.
  return (
    <div role="region" aria-label="执行过程详情" className="space-y-1 pt-1">
      {items.map((item) =>
        item.kind === 'tool' ? (
          <ToolRecord key={item.id} tool={item.tool} />
        ) : item.kind === 'message' ? (
          <div key={item.id} data-execution-message={item.id} className="py-1">
            <ReplyMarkdown
              stateKey={item.id}
              text={item.message.text}
              streaming={item.message.status === 'streaming'}
            />
          </div>
        ) : (
          <ProcessTextRecord key={item.id} id={item.id} text={item.text} stateKey={stateKey} />
        ),
      )}
    </div>
  )
})

export function ExecutionProcess({
  stateKey,
  items,
  active,
  startedAt,
  finishedAt,
  status,
}: {
  stateKey?: string
  items: ProcessItem[]
  active: boolean
  startedAt?: number
  finishedAt?: number
  status?: string
}) {
  const [choice, setChoice] = useConversationLocalState<{ active: boolean; open: boolean } | null>(
    stateKey ? `process:${stateKey}` : undefined,
    null,
  )
  const [prepared, setPrepared] = useState(false)
  if (active && prepared) setPrepared(false)
  useEffect(() => {
    if (active && choice) setChoice(null)
  }, [active, choice, setChoice])
  const tools = items.flatMap((item) => (item.kind === 'tool' ? [item.tool] : []))
  // Live work is represented by one changing status. Its archive is available after the turn ends.
  const open = !active && choice?.open === true
  const approvals = active ? tools.filter((tool) => tool.status === 'awaiting_approval') : []
  const failures = tools.filter((tool) => tool.status === 'failed').length
  const elapsed =
    startedAt !== undefined && finishedAt !== undefined
      ? Math.max(0, finishedAt - startedAt)
      : undefined

  if (!active && !items.length && elapsed !== undefined && elapsed <= 2000) return null

  function prepareRecords() {
    if (active || !items.length || open) return
    // Prepare archived rows while the pointer/focus approaches the trigger.
    // Concurrent work yields to input so opening can reuse the mounted rows.
    startTransition(() => setPrepared(true))
  }

  function discardPreparation() {
    if (!open) setPrepared(false)
  }

  return (
    <section data-execution-process className="space-y-3">
      <Collapsible
        open={open}
        onOpenChange={(open) => {
          setChoice({ active, open })
          if (!open) setPrepared(false)
        }}
      >
        <CollapsibleTrigger
          aria-label="执行过程"
          disabled={active || !items.length}
          onPointerEnter={prepareRecords}
          onFocus={prepareRecords}
          onPointerLeave={discardPreparation}
          onBlur={discardPreparation}
          className="flex w-full items-center gap-2 border-b border-border/60 pt-1 pb-2 text-left text-[14px] text-muted-foreground transition-colors duration-160 ease-out outline-none enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        >
          <ElapsedTime active={active} startedAt={startedAt} finishedAt={finishedAt} />
          {!active && items.length > 0 && (
            <ChevronRight
              aria-hidden
              className="conversation-disclosure-chevron size-3.5 shrink-0 in-data-panel-open:rotate-90"
            />
          )}
          {!active && failures > 0 ? (
            <span className="text-xs text-destructive">{failures} 次失败</span>
          ) : null}
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted={prepared} className="execution-process-content">
          <ProcessRecords items={items} stateKey={stateKey} />
        </CollapsibleContent>
      </Collapsible>
      {active && status && <ResponseWaiting text={status.replace(/(?:…|\.{3})$/, '')} />}
      {approvals.map((tool) => (
        <ToolRecord key={tool.id} tool={tool} compactApproval />
      ))}
    </section>
  )
}
