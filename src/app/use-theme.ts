import { useEffect, useLayoutEffect, useState } from 'react'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop, setWindowTheme } from '@/lib/desktop'
import { observeSystemTheme, usesNativeSystemTheme } from '@/lib/system-theme'

export function useTheme() {
  const theme = useWorkspaceStore((state) => state.theme)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const nativeTheme =
    theme === 'system' && isDesktop() && !usesNativeSystemTheme() ? null : dark ? 'dark' : 'light'

  useEffect(() => {
    let disposed = false
    let stop: (() => void) | undefined
    void observeSystemTheme((value) => {
      if (!disposed) setSystemDark(value)
    }).then(
      (unlisten) => {
        if (disposed) unlisten()
        else stop = unlisten
      },
      (reason: unknown) => {
        if (!disposed) console.warn('Unable to observe the system theme:', reason)
      },
    )
    return () => {
      disposed = true
      stop?.()
    }
  }, [])

  // Changing the preference without changing its resolved color must not repaint Mica.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute('data-native-backdrop', isDesktop() && usesNativeSystemTheme())
    const scheme = dark ? 'dark' : 'light'
    let frame: number | undefined
    let disposed = false
    const apply = () => {
      if (disposed) return
      if (root.classList.contains('dark') !== dark || root.style.colorScheme !== scheme) {
        root.setAttribute('data-theme-changing', '')
        root.classList.toggle('dark', dark)
        root.style.colorScheme = scheme
        void root.offsetHeight
        // Keep transitions disabled through the first paint of the new palette.
        frame = window.requestAnimationFrame(() => {
          frame = window.requestAnimationFrame(() => root.removeAttribute('data-theme-changing'))
        })
      }
    }
    if (isDesktop()) {
      void setWindowTheme(nativeTheme).then(apply, (reason: unknown) => {
        console.warn('Unable to update the native window theme:', reason)
        apply()
      })
    } else {
      apply()
      void setWindowTheme(nativeTheme)
    }
    return () => {
      disposed = true
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      root.removeAttribute('data-theme-changing')
      root.removeAttribute('data-native-backdrop')
    }
  }, [dark, nativeTheme])
}
