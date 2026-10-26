import { useEffect, useRef, type ReactNode, type Ref } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/scroll-area'

export function ExecutionRecord({
  icon: Icon,
  title,
  open,
  onOpenChange,
  headerRef,
  disabled,
  follow = false,
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
  summary?: ReactNode
  status?: ReactNode
  children: ReactNode
  'aria-label'?: string
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (!open || !follow || !atEnd.current || frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const element = viewport.current
      if (element && atEnd.current) element.scrollTop = element.scrollHeight
    })
  }, [children, follow, open])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="min-w-0" aria-label={label}>
      <CollapsibleTrigger
        ref={headerRef}
        disabled={disabled}
        className="execution-record-header flex w-full min-w-0 items-center gap-1.5 py-1 text-left text-[14px] font-medium text-foreground/65 transition-colors duration-160 ease-out outline-none enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <Icon aria-hidden className="size-3.5 shrink-0 stroke-[1.6]" />
        <span className="min-w-0 max-w-1/2 truncate">{title}</span>
        <ChevronRight
          aria-hidden
          className={`size-3.5 shrink-0 transition-transform duration-160 ease-out ${open ? 'rotate-90' : ''}`}
        />
        {summary}
        {status && <span className="ml-auto flex shrink-0 items-center gap-2">{status}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="execution-record-content">
        <ScrollArea
          ref={viewport}
          role="region"
          aria-label={`${title}详情`}
          viewportClassName="max-h-80 overflow-x-hidden overflow-y-auto py-2 pr-3 text-[14px] leading-[1.6] text-muted-foreground wrap-anywhere"
          onScroll={() => {
            const element = viewport.current
            if (element)
              atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
          }}
        >
          {children}
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  )
}
