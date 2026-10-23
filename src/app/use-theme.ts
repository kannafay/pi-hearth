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
    const scheme = dark ? 'dark' : 'light'
    if (root.classList.contains('dark') !== dark) root.classList.toggle('dark', dark)
    if (root.style.colorScheme !== scheme) root.style.colorScheme = scheme
    void setWindowTheme(nativeTheme).catch((reason: unknown) => {
      console.warn('Unable to update the native window theme:', reason)
    })
  }, [dark, nativeTheme])
}
