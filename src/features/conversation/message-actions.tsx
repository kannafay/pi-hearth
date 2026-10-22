import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Pencil, RotateCcw } from 'lucide-react'
import { IconButton } from '@/components/icon-button'
import { cn } from '@/lib/utils'

export function messageTime(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  const now = new Date()
  const today = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return {
    iso: date.toISOString(),
    full: date.toLocaleString('zh-CN', { hourCycle: 'h23' }),
    label: today
      ? time
      : `${date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}/`}${date.getMonth() + 1}/${date.getDate()} ${time}`,
  }
}

export function MessageActions({
  text,
  timestamp,
  user = false,
  disabled,
  onEdit,
  onRegenerate,
}: {
  text: string
  timestamp?: number
  user?: boolean
  disabled: boolean
  onEdit?: () => void
  onRegenerate?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (reset.current) clearTimeout(reset.current)
    },
    [],
  )
  const time = messageTime(timestamp)
  const button =
    'size-7 text-muted-foreground/70 transition-colors duration-150 hover:bg-muted/80 hover:text-foreground dark:hover:bg-white/10 dark:focus-visible:bg-white/10 dark:active:bg-white/15 [&_svg]:size-3.5'
  async function copy() {
    setError('')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (reset.current) clearTimeout(reset.current)
      reset.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('复制失败，请重试')
    }
  }
  return (
    <div
      role="group"
      aria-label={user ? '消息操作' : '回复操作'}
      className={cn(
        'message-actions flex min-h-7 flex-wrap items-center gap-0.5',
        user && 'justify-end',
      )}
    >
      {time && (
        <time
          dateTime={time.iso}
          aria-label={time.full}
          className="mr-1.5 text-[11px] text-muted-foreground/70 tabular-nums"
        >
          {time.label}
        </time>
      )}
      {!!text && (
        <IconButton
          label={user ? '复制消息' : '复制回复'}
          title={copied ? '已复制' : '复制'}
          className={button}
          onClick={() => void copy()}
        >
          {copied ? <Check /> : <Copy />}
        </IconButton>
      )}
      {onEdit && (
        <IconButton
          label="编辑消息"
          title="编辑"
          className={button}
          disabled={disabled}
          onClick={onEdit}
        >
          <Pencil />
        </IconButton>
      )}
      {onRegenerate && (
        <IconButton label="重新回答" className={button} disabled={disabled} onClick={onRegenerate}>
          <RotateCcw />
        </IconButton>
      )}
      {(error || copied) && (
        <span role="status" className={error ? 'ml-1 text-xs text-destructive' : 'sr-only'}>
          {error || '已复制'}
        </span>
      )}
    </div>
  )
}
