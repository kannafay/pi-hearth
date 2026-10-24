import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '@/components/icon-button'
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { WorkspaceDialog } from '@/components/workspace-dialog'

export function WorkspacePanelHeader({
  children,
  closeLabel,
  onClose,
}: {
  children: ReactNode
  closeLabel: string
  onClose: () => void
}) {
  return (
    <div
      data-slot="workspace-panel-header"
      className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3"
    >
      <div className="min-w-0 flex-1">{children}</div>
      <IconButton label={closeLabel} variant="panel" size="icon-sm" onClick={onClose}>
        <X className="stroke-[1.5]" />
      </IconButton>
    </div>
  )
}

export function WorkspaceFloatingPanel({
  children,
  title,
  description,
  side,
  width,
  open,
  onOpenChange,
  keepMounted = false,
}: {
  children: ReactNode
  title: string
  description: string
  side: 'left' | 'right'
  width: number
  open: boolean
  onOpenChange: (open: boolean) => void
  keepMounted?: boolean
}) {
  return (
    <WorkspaceDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        layout="drawer"
        side={side}
        keepMounted={keepMounted}
        style={{ width }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </WorkspaceDialog>
  )
}
