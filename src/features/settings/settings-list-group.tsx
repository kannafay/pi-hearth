import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export function SettingsListGroup({
  title,
  count,
  control,
  children,
}: {
  title: string
  count?: number
  control?: ReactNode
  children: ReactNode
}) {
  return (
    <Collapsible className="overflow-hidden rounded-md border">
      <div className="flex items-center transition-colors duration-160 ease-(--dialog-ease) hover:bg-accent">
        <CollapsibleTrigger className="flex h-10 min-w-0 flex-1 items-center gap-2 px-3 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-(--dialog-ease) in-data-panel-open:rotate-90" />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {count !== undefined && (
            <span className="text-xs text-muted-foreground" aria-hidden>
              {count}
            </span>
          )}
        </CollapsibleTrigger>
        {control && <div className="flex h-10 shrink-0 items-center px-3">{control}</div>}
      </div>
      <CollapsibleContent role="group" aria-label={title} className="settings-model-content">
        <div className="border-t p-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
