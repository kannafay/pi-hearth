import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function IconButton({
  label,
  title,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button type="button" variant="ghost" size="icon" aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent variant="card" showArrow={false}>
        {title ?? label}
      </TooltipContent>
    </Tooltip>
  )
}
