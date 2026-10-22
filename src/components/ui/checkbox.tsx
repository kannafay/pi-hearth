import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Checkbox({ className, indeterminate, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        'inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-input outline-none transition-[background-color,border-color,color,box-shadow] duration-160 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        keepMounted
        className="flex items-center justify-center opacity-0 transition-opacity duration-160 data-checked:opacity-100 data-indeterminate:opacity-100"
      >
        {indeterminate ? <Minus className="size-3" /> : <Check className="size-3" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
