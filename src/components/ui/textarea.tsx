import * as React from 'react'
import { cn } from 'cn'
import { OverlayScrollbars } from 'overlayscrollbars'
import { ScrollArea } from '@/components/scroll-area'

function Textarea({ className, value, disabled, ...props }: React.ComponentProps<'textarea'>) {
  const host = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (host.current) OverlayScrollbars(host.current)?.update(true)
  }, [value])
  return (
    <ScrollArea
      ref={host}
      data-slot="textarea-scroll"
      data-disabled={disabled || undefined}
      className="w-full"
      viewportClassName={cn(
        'textarea-scroll min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:bg-input/50 has-disabled:opacity-50 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:has-disabled:bg-input/80 dark:has-aria-invalid:border-destructive/50 dark:has-aria-invalid:ring-destructive/40',
        className,
      )}
      onClick={(event) => {
        if (event.target === event.currentTarget) host.current?.querySelector('textarea')?.focus()
      }}
    >
      <textarea data-slot="textarea" value={value} disabled={disabled} {...props} />
    </ScrollArea>
  )
}

export { Textarea }
