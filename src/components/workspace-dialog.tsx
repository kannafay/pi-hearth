import type { ComponentProps } from 'react'
import { Dialog } from '@/components/ui/dialog'

// WorkspaceShell makes the content inert while the window header stays usable.
export function WorkspaceDialog({
  onOpenChange,
  ...props
}: Omit<ComponentProps<typeof Dialog>, 'modal'>) {
  return (
    <Dialog
      {...props}
      modal={false}
      onOpenChange={(open, details) => {
        const target = details.event.target
        if (
          !open &&
          (details.reason === 'focus-out' ||
            (details.reason === 'outside-press' &&
              target instanceof Element &&
              target.closest('[data-window-header]')))
        ) {
          details.cancel()
          return
        }
        onOpenChange?.(open, details)
      }}
    />
  )
}
