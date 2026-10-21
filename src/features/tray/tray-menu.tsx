import { Fragment, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { AppWindow, LoaderCircle, LogOut, RotateCw } from 'lucide-react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useMediaQuery } from '@/app/use-media-query'

type Action = 'show' | 'restart' | 'quit'
type Phase = 'preparing' | 'open' | 'closing'
type MenuSignal =
  | { type: 'open'; epoch: number; dark: boolean; origin: string }
  | { type: 'shown'; epoch: number }
  | { type: 'close'; epoch: number }
  | { type: 'key'; epoch: number; key: string; shift: boolean }

const actions = [
  { action: 'show', label: '界面', icon: AppWindow },
  { action: 'restart', label: '重启', icon: RotateCw },
  { action: 'quit', label: '退出', icon: LogOut },
] as const

export function TrayMenu({
  onAction,
  onDismiss,
  phase = 'open',
  origin = 'left top',
  onClosed,
}: {
  onAction: (action: Action) => Promise<void>
  onDismiss: () => void
  phase?: Phase
  origin?: string
  onClosed?: () => void
}) {
  const [active, setActive] = useState(-1)
  const [pending, setPending] = useState<Action | null>(null)
  const [failed, setFailed] = useState<Action | null>(null)
  const acting = useRef(false)
  const closed = useRef(false)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  const finishClose = useCallback(() => {
    if (phase !== 'closing' || closed.current) return
    closed.current = true
    onClosed?.()
  }, [phase, onClosed])

  useEffect(() => {
    if (reduceMotion) finishClose()
  }, [reduceMotion, finishClose])

  async function act(action: Action) {
    if (phase !== 'open' || acting.current) return
    acting.current = true
    setPending(action)
    setFailed(null)
    try {
      await onAction(action)
    } catch (reason) {
      console.warn('Tray action failed:', reason)
      setFailed(action)
    } finally {
      acting.current = false
      setPending(null)
    }
  }

  const keyDown = useEffectEvent((event: KeyboardEvent) => {
    if (phase !== 'open') return
    if (event.key === 'Escape') {
      event.preventDefault()
      onDismiss()
      return
    }
    if (acting.current) return
    if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault()
      setActive((index) => (index + 1) % actions.length)
    } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault()
      setActive((index) => (index <= 0 ? actions.length - 1 : index - 1))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : actions.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (active >= 0) void act(actions[active].action)
    }
  })

  useEffect(() => {
    const handle = (event: KeyboardEvent) => keyDown(event)
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])

  return (
    <div className="h-full w-full p-3" onContextMenu={(event) => event.preventDefault()}>
      <div
        role="menu"
        aria-label="Pi Hearth"
        aria-activedescendant={active >= 0 ? `tray-${actions[active].action}` : undefined}
        data-state={phase}
        style={{ transformOrigin: origin }}
        className="tray-menu-card rounded-xl bg-popover p-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        onPointerLeave={() => setActive(-1)}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === 'opacity')
            finishClose()
        }}
      >
        {actions.map(({ action, label, icon: Icon }, index) => (
          <Fragment key={action}>
            {action === 'quit' && <div role="separator" className="mx-1 my-1 h-px bg-border" />}
            <button
              id={`tray-${action}`}
              role="menuitem"
              type="button"
              tabIndex={-1}
              disabled={phase !== 'open' || pending !== null}
              data-pending={pending !== null || undefined}
              data-highlighted={active === index || undefined}
              data-destructive={action === 'quit' || undefined}
              className="tray-menu-item"
              // Pointer selection must not activate the WebView window.
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(index)}
              onClick={() => void act(action)}
            >
              {pending === action ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Icon className="size-4 stroke-[1.6]" />
              )}
              {failed === action ? `${label}失败，请重试` : label}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export function TrayMenuApp() {
  const [session, setSession] = useState<{ epoch: number; phase: Phase; origin: string } | null>(
    null,
  )
  const epoch = useRef<number | null>(null)
  const opened = useRef(false)

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let frame = 0
    const cancelReveal = () => window.cancelAnimationFrame(frame)
    const stop = listen<MenuSignal>('tray-menu-signal', ({ payload }) => {
      if (disposed) return
      if (payload.type === 'open') {
        cancelReveal()
        epoch.current = payload.epoch
        opened.current = false
        document.documentElement.classList.toggle('dark', payload.dark)
        document.documentElement.style.colorScheme = payload.dark ? 'dark' : 'light'
        setSession({ epoch: payload.epoch, phase: 'preparing', origin: payload.origin })
      } else if (payload.epoch === epoch.current) {
        if (payload.type === 'shown') {
          cancelReveal()
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            opened.current = true
            setSession((current) => (current ? { ...current, phase: 'open' } : current))
            return
          }
          // Paint the transparent starting state after the native show, then
          // reveal. Hidden WebViews must not finish the animation beforehand.
          frame = window.requestAnimationFrame(() => {
            frame = window.requestAnimationFrame(() => {
              if (disposed || epoch.current !== payload.epoch) return
              opened.current = true
              setSession((current) => (current ? { ...current, phase: 'open' } : current))
            })
          })
        } else if (payload.type === 'close') {
          cancelReveal()
          epoch.current = null
          if (opened.current) {
            setSession((current) => (current ? { ...current, phase: 'closing' } : current))
          } else {
            void invoke('tray_closed', { epoch: payload.epoch }).catch(console.warn)
          }
        } else {
          window.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: payload.key,
              shiftKey: payload.shift,
              cancelable: true,
            }),
          )
        }
      }
    })
    void stop
      .then(() => {
        if (!disposed) return invoke('tray_ready')
      })
      .catch(console.warn)
    return () => {
      disposed = true
      cancelReveal()
      void stop.then((unlisten) => unlisten()).catch(console.warn)
    }
  }, [])

  const sessionEpoch = session?.epoch
  useEffect(() => {
    if (sessionEpoch !== undefined && isTauri())
      void invoke('tray_present', { epoch: sessionEpoch }).catch(console.warn)
  }, [sessionEpoch])

  if (!session) return null
  return (
    <TrayMenu
      key={session.epoch}
      phase={session.phase}
      origin={session.origin}
      onAction={(action) => invoke('tray_action', { epoch: session.epoch, action })}
      onDismiss={() => {
        void invoke('tray_dismiss', { epoch: session.epoch }).catch(console.warn)
      }}
      onClosed={() => {
        void invoke('tray_closed', { epoch: session.epoch }).catch(console.warn)
      }}
    />
  )
}
