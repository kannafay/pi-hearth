import { useLayoutEffect, useRef } from 'react'
import { listenForWindowFocus } from '@/lib/desktop'

export function useWindowFocus() {
  const shell = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    // Activation must not wait for the conversation tree to render.
    const update = (focused: boolean) => {
      const value = String(focused)
      if (!disposed && shell.current && shell.current.dataset.windowFocused !== value) {
        shell.current.dataset.windowFocused = value
      }
    }
    update(document.hasFocus())
    void listenForWindowFocus(update).then(
      (unlisten) => {
        if (disposed) unlisten()
        else cleanup = unlisten
      },
      (reason: unknown) => {
        if (!disposed) console.warn('Unable to observe native window focus:', reason)
      },
    )
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  return shell
}
