'use client'

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from 'cn'

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  variant = 'default',
  showArrow = true,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & { variant?: 'default' | 'card'; showArrow?: boolean } & Pick<
    TooltipPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset'
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md px-3 py-1.5 text-xs has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            variant === 'card'
              ? 'rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10'
              : 'bg-foreground text-background',
            className,
          )}
          {...props}
        >
          {children}
          {showArrow && (
            <TooltipPrimitive.Arrow
              data-slot="tooltip-arrow"
              className={cn(
                'z-50 size-2.5 rotate-45 rounded-[2px] data-[side=bottom]:-top-1.25 data-[side=left]:-right-1.25 data-[side=right]:-left-1.25 data-[side=top]:-bottom-1.25',
                variant === 'card'
                  ? 'border-foreground/10 bg-popover data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=left]:border-t data-[side=left]:border-r data-[side=right]:border-b data-[side=right]:border-l data-[side=top]:border-r data-[side=top]:border-b'
                  : 'bg-foreground',
              )}
            />
          )}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
