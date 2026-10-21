import { useEffect, useRef, useState } from 'react'
import { ChevronRight, LoaderCircle } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ProcessItem } from './conversation-turns'
import { ToolRecord } from './tool-record'
import { ScrollArea } from '@/components/scroll-area'

export function ExecutionProcess({ items, active }: { items: ProcessItem[]; active: boolean }) {
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
        disabled={awaiting}
        className="flex max-w-full items-center gap-2 rounded-md py-1 text-left text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <ChevronRight aria-hidden className="size-3.5 shrink-0 in-data-panel-open:rotate-90" />
        {active && !awaiting && (
          <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin" />
        )}
        <span>执行过程</span>
        {tools.length > 0 && <span className="text-xs">{tools.length} 次工具调用</span>}
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
          className="mt-2"
          viewportClassName="max-h-80 space-y-2 overflow-x-hidden overflow-y-auto border-l border-border/70 pl-3"
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
