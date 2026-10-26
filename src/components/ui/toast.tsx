import { Toast } from '@base-ui/react/toast'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toastManager } from '@/lib/toast'

export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="toast-viewport" data-slot="toast-viewport" aria-label="操作通知">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((notification) => {
    const Icon =
      notification.type === 'error'
        ? CircleAlert
        : notification.type === 'success'
          ? CircleCheck
          : Info
    return (
      <Toast.Root
        key={notification.id}
        toast={notification}
        swipeDirection={[]}
        data-slot="toast"
        className="app-toast flex items-start gap-2.5 rounded-lg border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon
          aria-hidden
          className={`mt-0.5 size-4 shrink-0 ${
            notification.type === 'error'
              ? 'text-destructive'
              : notification.type === 'success'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground'
          }`}
        />
        <Toast.Title className="max-h-36 min-w-0 flex-1 overflow-y-auto text-sm leading-5 whitespace-pre-wrap wrap-anywhere" />
        <Toast.Close
          aria-label="关闭通知"
          aria-hidden={false}
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              className="-my-0.5 -mr-1 text-muted-foreground"
            />
          }
        >
          <X className="size-3.5" />
        </Toast.Close>
      </Toast.Root>
    )
  })
}
