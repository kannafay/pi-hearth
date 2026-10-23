import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-input bg-input p-0.5 outline-none transition-colors duration-160 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:border-primary data-checked:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform duration-160 data-checked:translate-x-4 data-checked:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  )
}
