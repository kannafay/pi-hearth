import { Fragment, useEffect, useRef, useState } from 'react'
import { AppWindow, LoaderCircle, LogOut, RotateCw } from 'lucide-react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type Action = 'show' | 'restart' | 'quit'

export function TrayMenu({
  onAction,
  onDismiss,
}: {
  onAction: (action: Action) => Promise<void>
  onDismiss: () => void
}) {
  const firstItem = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [failed, setFailed] = useState<Action | null>(null)

  useEffect(() => {
    const focusFirst = () => firstItem.current?.focus()
    const frame = requestAnimationFrame(focusFirst)
    const stop = isTauri()
      ? getCurrentWindow().onFocusChanged(({ payload }) => {
          if (payload) focusFirst()
        })
      : null
    window.addEventListener('focus', focusFirst)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('focus', focusFirst)
      void stop?.then((unlisten) => unlisten()).catch(console.warn)
    }
  }, [])

  async function act(action: Action) {
    if (pending) return
    setPending(action)
    setFailed(null)
    try {
      await onAction(action)
    } catch (reason) {
      console.warn('Tray action failed:', reason)
      setFailed(action)
    } finally {
      setPending(null)
    }
  }

  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
    >
      <DropdownMenuTrigger
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none absolute top-2 left-2 size-0 overflow-hidden"
      />
      <DropdownMenuContent
        aria-label="Pi Hearth"
        sideOffset={0}
        align="start"
        finalFocus={false}
        className="w-[calc(100vw-16px)] max-w-48 rounded-xl p-1 shadow-md data-open:animate-none"
      >
        {(
          [
            ['show', '界面', AppWindow],
            ['restart', '重启', RotateCw],
            ['quit', '退出', LogOut],
          ] as const
        ).map(([action, label, Icon]) => (
          <Fragment key={action}>
            {action === 'quit' && <DropdownMenuSeparator className="mx-1 my-1" />}
            <DropdownMenuItem
              ref={action === 'show' ? firstItem : undefined}
              disabled={pending !== null}
              closeOnClick={false}
              variant={action === 'quit' ? 'destructive' : 'default'}
              className="h-8 gap-2.5 px-2 text-[13px]"
              onClick={() => void act(action)}
            >
              {pending === action ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Icon className="size-4 stroke-[1.6]" />
              )}
              {failed === action ? `${label}失败，请重试` : label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TrayMenuApp() {
  useEffect(() => {
    if (!isTauri()) return
    const native = getCurrentWindow()
    let themeChanged = false
    let disposed = false
    const apply = (theme: string | null) => {
      document.documentElement.classList.toggle('dark', theme === 'dark')
      document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
    }
    const stop = native.onThemeChanged(({ payload }) => {
      themeChanged = true
      apply(payload)
    })
    void native
      .theme()
      .then((theme) => {
        if (!disposed && !themeChanged) apply(theme)
      })
      .catch(console.warn)
    return () => {
      disposed = true
      void stop.then((unlisten) => unlisten()).catch(console.warn)
    }
  }, [])

  return (
    <TrayMenu
      onAction={async (action) => {
        if (isTauri()) await invoke('tray_action', { action })
      }}
      onDismiss={() => {
        if (isTauri()) void invoke('tray_dismiss').catch(console.warn)
      }}
    />
  )
}
