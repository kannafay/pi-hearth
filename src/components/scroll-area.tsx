import type { ComponentProps } from 'react'
import { cn } from 'cn'

// The bars live outside the scrolling viewport, so their position can never
// extend the scroll range when content shrinks or a process finishes.
export function ScrollArea({
  className,
  viewportClassName,
  children,
  ...props
}: ComponentProps<'div'> & { viewportClassName?: string }) {
  return (
    <div className={cn('relative min-h-0 min-w-0', className)}>
      <div
        {...props}
        data-scroll-area
        data-scrollbars-external
        className={cn('min-h-0 min-w-0 overflow-auto', viewportClassName)}
      >
        {children}
      </div>
      <div data-scrollbars-slot className="pointer-events-none absolute inset-0" />
    </div>
  )
}
