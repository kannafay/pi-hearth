import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/scroll-area'
import { useConversationLocalState } from './conversation-local-state'
import { describeResponseError } from './response-error-message'

export function ResponseError({ error, stateKey }: { error: string; stateKey: string }) {
  const [open, setOpen] = useConversationLocalState(`failure:${stateKey}:${error}`, false)
  const failure = describeResponseError(error)

  return (
    <div className="space-y-1.5">
      <p role="alert" className="text-sm leading-6 text-destructive">
        {failure?.message ?? '本次请求未完成，请稍后重试。'}
      </p>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-sm py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          失败原因
          <ChevronRight
            aria-hidden
            className={`conversation-disclosure-chevron size-3 ${open ? 'rotate-90' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="response-error-content">
          <div className="pt-2">
            <ScrollArea
              role="region"
              aria-label="失败原因详情"
              viewportClassName="max-h-56 overflow-y-auto rounded-sm border bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground"
            >
              {failure?.hint && <p className="mb-2">{failure.hint}</p>}
              <pre className="font-mono whitespace-pre-wrap wrap-anywhere text-foreground/75">
                {error}
              </pre>
            </ScrollArea>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
