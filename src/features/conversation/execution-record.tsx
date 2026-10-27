import { useContext, useEffect, useRef, type ReactNode, type Ref } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/scroll-area'
import { ExecutionInspection } from './use-execution-record'

export function ExecutionRecord({
  icon: Icon,
  title,
  open,
  onOpenChange,
  headerRef,
  disabled,
  follow = false,
  revealEnd = false,
  summary,
  status,
  children,
  'aria-label': label,
}: {
  icon: LucideIcon
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  headerRef: Ref<HTMLButtonElement>
  disabled?: boolean
  follow?: boolean
  revealEnd?: boolean
  summary?: ReactNode
  status?: ReactNode
  children: ReactNode
  'aria-label'?: string
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  const frame = useRef<number | null>(null)
  const inspect = useContext(ExecutionInspection)

  useEffect(() => {
    // A new approval must reveal its actions even if the previous output was read above.
    if (revealEnd) atEnd.current = true
  }, [revealEnd])

  useEffect(() => {
    if (!open || !follow) return
    const schedule = () => {
      if (!atEnd.current || frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        const element = viewport.current
        if (element && atEnd.current) element.scrollTop = element.scrollHeight
      })
    }
    schedule()
    // Follow layout changes too, including opening animations and wrapped long parameters.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (viewport.current) observer?.observe(viewport.current)
    if (content.current) observer?.observe(content.current)
    return () => {
      observer?.disconnect()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [children, follow, open, revealEnd])

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="min-w-0" aria-label={label}>
      <CollapsibleTrigger
        ref={headerRef}
        disabled={disabled}
        className="execution-record-header flex w-full min-w-0 items-center gap-1.5 py-1 text-left text-[14px] font-medium text-foreground/65 outline-none enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-panel-open:pb-2"
      >
        <Icon aria-hidden className="size-3.5 shrink-0 stroke-[1.6]" />
        <span className="min-w-0 max-w-1/2 truncate">{title}</span>
        <ChevronRight
          aria-hidden
          className={`conversation-disclosure-chevron size-3.5 shrink-0 ${open ? 'rotate-90' : ''}`}
        />
        {summary}
        {status && <span className="ml-auto flex shrink-0 items-center gap-2">{status}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="execution-record-content">
        <div>
          <ScrollArea
            ref={viewport}
            role="region"
            aria-label={`${title}详情`}
            viewportClassName="max-h-76 overflow-x-hidden overflow-y-auto pr-3 text-[14px] leading-[1.6] text-muted-foreground wrap-anywhere"
            onWheel={(event) => {
              if (event.deltaY < 0) inspect?.()
            }}
            onTouchStart={() => inspect?.()}
            onKeyDown={(event) => {
              if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) inspect?.()
            }}
            onScroll={() => {
              const element = viewport.current
              if (element)
                atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
            }}
          >
            <div ref={content} className="pb-0.5">
              {children}
            </div>
          </ScrollArea>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
