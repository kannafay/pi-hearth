import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '@/app/store'
import { finishWindowThemeChange, isDesktop, setWindowTheme } from '@/lib/desktop'
import { observeSystemTheme, usesNativeSystemTheme } from '@/lib/system-theme'
import { finishThemeColorTransitions } from './theme-transitions'

export function useTheme() {
  const theme = useWorkspaceStore((state) => state.theme)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const currentRequest = useRef<string | null>(null)
  const nativeTheme =
    theme === 'system' && isDesktop() && !usesNativeSystemTheme() ? null : dark ? 'dark' : 'light'
  const applyThemeMode = useEffectEvent(() => {
    const root = document.documentElement
    if (root.dataset.themeMode !== theme) root.dataset.themeMode = theme
  })

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
    const changed = root.classList.contains('dark') !== dark || root.style.colorScheme !== scheme
    const request =
      (changed || currentRequest.current !== null) && isDesktop() && usesNativeSystemTheme()
        ? crypto.randomUUID()
        : null
    currentRequest.current = request
    const finish = () =>
      request &&
      finishWindowThemeChange(request)
        .catch((reason: unknown) => {
          console.warn('Unable to finish the native theme change:', reason)
        })
        .finally(() => {
          if (currentRequest.current === request) currentRequest.current = null
        })
    const apply = () => {
      if (disposed) return
      if (changed) {
        root.setAttribute('data-theme-changing', '')
        root.classList.toggle('dark', dark)
        root.style.colorScheme = scheme
        void root.offsetHeight
        finishThemeColorTransitions()
      }
      // Present the header glyph in the same scene as the committed palette.
      applyThemeMode()
      if (changed || request) {
        // Reveal only after the new WebView palette has had a paint opportunity.
        frame = window.requestAnimationFrame(() => {
          finishThemeColorTransitions()
          frame = window.requestAnimationFrame(() => {
            finishThemeColorTransitions()
            frame = window.requestAnimationFrame(() => {
              void finish()
              root.removeAttribute('data-theme-changing')
            })
          })
        })
      }
    }
    if (request) {
      root.setAttribute('data-theme-changing', '')
      void setWindowTheme(nativeTheme, request).then(apply, (reason: unknown) => {
        console.warn('Unable to update the native window theme:', reason)
        apply()
      })
    } else {
      apply()
      void setWindowTheme(nativeTheme).catch((reason: unknown) => {
        console.warn('Unable to update the native window theme:', reason)
      })
    }
    return () => {
      disposed = true
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      // A replacement request keeps the current cover; unmount releases it.
      queueMicrotask(() => {
        if (currentRequest.current === request) void finish()
      })
      root.removeAttribute('data-theme-changing')
      root.removeAttribute('data-native-backdrop')
    }
  }, [dark, nativeTheme])

  // Switching between automatic and explicit modes may keep the same palette.
  useLayoutEffect(() => {
    const root = document.documentElement
    if (
      root.classList.contains('dark') === dark &&
      root.style.colorScheme === (dark ? 'dark' : 'light')
    )
      applyThemeMode()
  }, [dark, theme])
}
