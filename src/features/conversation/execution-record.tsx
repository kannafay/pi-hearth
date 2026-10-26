import type { ReactNode, Ref } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export function ExecutionRecord({
  icon: Icon,
  title,
  open,
  onOpenChange,
  headerRef,
  disabled,
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
  summary?: ReactNode
  status?: ReactNode
  children: ReactNode
  'aria-label'?: string
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="min-w-0" aria-label={label}>
      <CollapsibleTrigger
        ref={headerRef}
        disabled={disabled}
        className="execution-record-header flex w-full min-w-0 items-center gap-1.5 py-1.5 text-left text-[14px] font-medium text-foreground/65 transition-colors duration-160 ease-out outline-none enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
        <div className="py-2 text-[14px] leading-[1.65] text-muted-foreground wrap-anywhere">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
