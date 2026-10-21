import { useEffect, useState } from 'react'
import { listenForWindowFocus } from '@/lib/desktop'

export function useWindowFocus() {
  const [focused, setFocused] = useState(() => document.hasFocus())

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    void listenForWindowFocus((value) => {
      if (!disposed) setFocused(value)
    }).then(
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

  return focused
}
