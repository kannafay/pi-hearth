import { Popover } from '@base-ui/react/popover'
import { useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from 'cn'
import { Button, buttonVariants } from '@/components/ui/button'
import { thinkingCapabilitiesPending, useConversationStore } from './store'

const percentFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })
const tokenFormat = new Intl.NumberFormat('zh-CN')

export function ContextUsageIndicator() {
  const usage = useConversationStore((state) =>
    thinkingCapabilitiesPending(state) ? null : state.contextUsage,
  )
  const sessionId = useConversationStore((state) => state.sessionId)
  const instanceId = useConversationStore((state) => state.instanceId)
  const detailsActions = useRef<Popover.Root.Actions>(null)
  const percent = usage?.percent ?? null
  const label = percent === null ? '—' : `${percentFormat.format(percent)}%`
  const progress = Math.min(100, Math.max(0, percent ?? 0))
  const remaining =
    usage?.tokens === null || !usage ? null : Math.max(0, usage.contextWindow - usage.tokens)

  return (
    <Popover.Root key={`${sessionId}:${instanceId}`} actionsRef={detailsActions}>
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
            <Popover.Description className="mt-3 leading-relaxed text-muted-foreground">
              {percent === null
                ? usage
                  ? '上下文整理后，等待下一次回复更新用量。'
                  : '暂未获取到当前会话的上下文用量。'
                : '由 Pi 估算当前上下文，包含消息和工具输出。'}
            </Popover.Description>
            <ContextCompactionButton onConfirm={() => detailsActions.current?.close()} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ContextCompactionButton({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  const { instanceId, status, readOnly, settingsPending, hasMessages, activity, compact } =
    useConversationStore(
      useShallow((state) => ({
        instanceId: state.instanceId,
        status: state.status,
        readOnly: state.readOnly,
        settingsPending: state.settingsPending,
        hasMessages: state.messages.length > 0,
        activity: state.activity,
        compact: state.compact,
      })),
    )
  const disabled =
    !instanceId || status !== 'ready' || Boolean(readOnly || settingsPending) || !hasMessages

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        render={<Button variant="outline" size="sm" className="mt-3 w-full" />}
      >
        {activity === '正在压缩上下文…' ? '正在压缩…' : '压缩上下文'}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} className="z-60">
          <Popover.Popup className="w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-popover p-3 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-opacity duration-150 outline-none data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none">
            <Popover.Title className="font-medium">压缩当前会话？</Popover.Title>
            <Popover.Description className="mt-2 leading-relaxed text-muted-foreground">
              将较早的对话整理为摘要，保留近期消息。
            </Popover.Description>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => {
                  if (
                    !open ||
                    disabled ||
                    useConversationStore.getState().instanceId !== instanceId
                  )
                    return
                  setOpen(false)
                  onConfirm()
                  void compact()
                }}
              >
                确认压缩
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
