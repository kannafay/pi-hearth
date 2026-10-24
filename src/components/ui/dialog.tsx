import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from 'cn'
import { cva, type VariantProps } from 'class-variance-authority'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/scroll-area'
import { XIcon } from 'lucide-react'

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 isolate z-50', className)}
      {...props}
    />
  )
}

const dialogContentVariants = cva(
  'fixed top-1/2 left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover text-sm text-popover-foreground shadow-(--dialog-shadow) ring-1 ring-foreground/10 outline-none',
  {
    variants: {
      size: {
        sm: 'sm:max-w-100',
        default: 'sm:max-w-120',
        lg: 'sm:max-w-136',
        xl: 'sm:max-w-190',
        search: 'sm:max-w-150',
      },
      layout: {
        default: 'grid gap-5 p-6',
        panel: 'flex flex-col gap-0 overflow-hidden p-0',
        preview:
          'top-[calc((100dvh+var(--titlebar-height))/2)] grid h-[min(620px,calc(100dvh-var(--titlebar-height)-3rem))] w-[min(900px,calc(100vw-3rem))] grid-rows-[auto_minmax(0,1fr)] gap-5 overflow-hidden p-6 sm:max-w-none',
        drawer:
          'top-(--titlebar-height) flex h-[calc(100dvh-var(--titlebar-height)-var(--workspace-inset))] w-100 max-w-[calc(100%-2*var(--workspace-inset))] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-(--workspace-radius) border border-(--workspace-border) p-0 ring-0 sm:max-w-[calc(100%-2*var(--workspace-inset))]',
      },
      side: {
        left: '',
        right: '',
      },
    },
    compoundVariants: [
      { layout: 'drawer', side: 'left', className: 'right-auto left-(--workspace-inset)' },
      { layout: 'drawer', side: 'right', className: 'right-(--workspace-inset) left-auto' },
    ],
    defaultVariants: { size: 'default', layout: 'default', side: 'right' },
  },
)

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = 'default',
  layout = 'default',
  side = 'right',
  keepMounted = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  keepMounted?: boolean
} & VariantProps<typeof dialogContentVariants>) {
  return (
    <DialogPortal keepMounted={keepMounted}>
      <DialogOverlay data-dialog-layout={layout} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-dialog-layout={layout}
        data-side={side}
        data-size={size}
        className={cn(dialogContentVariants({ size, layout, side }), className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">关闭弹窗</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & { variant?: 'default' | 'compact' }) {
  return (
    <div
      data-slot="dialog-header"
      data-variant={variant}
      className={cn(
        'flex shrink-0 flex-col gap-1.5',
        variant === 'default' && 'border-b pr-8 pb-5',
        className,
      )}
      {...props}
    />
  )
}

function DialogForm({ className, ...props }: React.ComponentProps<'form'>) {
  return <form data-slot="dialog-form" className={cn('contents', className)} {...props} />
}

function DialogBody({
  className,
  viewportClassName,
  ...props
}: React.ComponentProps<'div'> & { viewportClassName?: string }) {
  return (
    <ScrollArea
      data-slot="dialog-body"
      className={cn('-m-1 min-h-0', className)}
      viewportClassName={cn('space-y-5 p-1', viewportClassName)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-6 -mb-6 flex shrink-0 flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/25 px-6 py-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>关闭</DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-heading text-lg leading-7 font-medium wrap-anywhere', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-xs leading-5 text-muted-foreground wrap-anywhere *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
