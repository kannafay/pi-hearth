import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export function SettingsListGroup({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <Collapsible className="overflow-hidden rounded-md border">
      <CollapsibleTrigger className="flex h-10 w-full items-center gap-2 px-3 text-left text-[13px] transition-colors duration-160 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-(--dialog-ease) in-data-panel-open:rotate-90" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="text-xs text-muted-foreground" aria-hidden>
          {count}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent role="group" aria-label={title} className="settings-model-content">
        <div className="border-t p-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
