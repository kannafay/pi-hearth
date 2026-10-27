import { Popover } from '@base-ui/react/popover'
import { cn } from 'cn'
import { buttonVariants } from '@/components/ui/button'
import { thinkingCapabilitiesPending, useConversationStore } from './store'

const percentFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })
const tokenFormat = new Intl.NumberFormat('zh-CN')

export function ContextUsageIndicator() {
  const usage = useConversationStore((state) =>
    thinkingCapabilitiesPending(state) ? null : state.contextUsage,
  )
  const sessionId = useConversationStore((state) => state.sessionId)
  const instanceId = useConversationStore((state) => state.instanceId)
  const percent = usage?.percent ?? null
  const label = percent === null ? '—' : `${percentFormat.format(percent)}%`
  const progress = Math.min(100, Math.max(0, percent ?? 0))
  const remaining =
    usage?.tokens === null || !usage ? null : Math.max(0, usage.contextWindow - usage.tokens)

  return (
    <Popover.Root key={`${sessionId}:${instanceId}`}>
      <Popover.Trigger
        openOnHover
        delay={200}
        closeDelay={100}
        aria-label="上下文用量"
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
          'text-muted-foreground',
        )}
      >
        <svg viewBox="0 0 20 20" className="size-4 -rotate-90" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" opacity="0.16" />
          <circle
            cx="10"
            cy="10"
            r="7.5"
            pathLength="100"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - progress}
            className={cn(
              'transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none',
              progress === 0 && 'invisible',
            )}
          />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={10} className="z-50">
          <Popover.Popup
            initialFocus={false}
            className="w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-popover p-3 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-opacity duration-150 outline-none data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <Popover.Title className="font-medium">上下文用量</Popover.Title>
              <span className="text-muted-foreground tabular-nums">{label}</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 tabular-nums">
              <dt className="text-muted-foreground">已使用</dt>
              <dd className="text-right">
                {usage?.tokens == null ? '—' : `${tokenFormat.format(usage.tokens)} tokens`}
              </dd>
              <dt className="text-muted-foreground">剩余</dt>
              <dd className="text-right">
                {remaining === null ? '—' : `${tokenFormat.format(remaining)} tokens`}
              </dd>
              <dt className="text-muted-foreground">总容量</dt>
              <dd className="text-right">
                {usage ? `${tokenFormat.format(usage.contextWindow)} tokens` : '—'}
              </dd>
            </dl>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
