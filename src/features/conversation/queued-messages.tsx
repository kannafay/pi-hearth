import { useState } from 'react'
import { ChevronUp, ListPlus, X } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { IconButton } from '@/components/icon-button'
import type { QueuedMessage } from '@/lib/generated/pi'
import { toast } from '@/lib/toast'

export function QueuedMessages({
  messages,
  connected,
  disconnected,
  onRemove,
}: {
  messages: QueuedMessage[]
  connected: boolean
  disconnected: boolean
  onRemove: (id: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="relative -mb-2 mx-6 overflow-hidden rounded-t-xl border border-b-0 border-input bg-(--composer-project-background) pb-2"
    >
      <CollapsibleTrigger
        aria-label="待发送消息"
        className="flex h-9 w-full min-w-0 items-center gap-2 px-3 text-left text-xs font-normal text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ListPlus aria-hidden className="size-3.5 shrink-0 stroke-[1.5]" />
        <span role="status" aria-atomic="true" className="shrink-0">
          待发送 {messages.length} 条
        </span>
        <span className="min-w-0 flex-1 truncate">
          {disconnected ? '连接已断开，消息仍保留' : '当前回复结束后依次处理'}
        </span>
        <ChevronUp
          aria-hidden
          className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="execution-record-content">
        <ol
          aria-label="待发送消息列表"
          className="max-h-40 space-y-1 overflow-y-auto border-t border-border/60 px-3 py-2"
        >
          {messages.map((message, index) => {
            const text = message.text || message.attachments.map((file) => file.name).join('、')
            return (
              <li key={message.id} className="flex min-w-0 items-center gap-2 text-xs">
                <span aria-hidden className="text-muted-foreground">
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate" title={text}>
                  {text}
                  {message.text &&
                    message.attachments.length > 0 &&
                    ` · ${message.attachments.length} 个附件`}
                </span>
                <IconButton
                  label={`取消排队消息 ${index + 1}`}
                  size="icon-xs"
                  disabled={!connected}
                  onClick={() => void onRemove(message.id).catch(toast.error)}
                >
                  <X className="size-3" />
                </IconButton>
              </li>
            )
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}
