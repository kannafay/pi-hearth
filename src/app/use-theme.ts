import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '@/app/store'
import { finishWindowThemeChange, isDesktop, setWindowTheme } from '@/lib/desktop'
import { observeSystemTheme, usesNativeSystemTheme } from '@/lib/system-theme'
import { finishThemeColorTransitions } from './theme-transitions'

export function useTheme() {
  const theme = useWorkspaceStore((state) => state.theme)
  const background = useWorkspaceStore((state) => state.windowBackground)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const currentRequest = useRef<string | null>(null)
  const currentBackground = useRef(background)
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

  useLayoutEffect(() => () => document.documentElement.removeAttribute('data-native-backdrop'), [])

  // Keep the native material and WebView palette in the same presented scene.
  useLayoutEffect(() => {
    const root = document.documentElement
    const native = isDesktop() && usesNativeSystemTheme()
    const scheme = dark ? 'dark' : 'light'
    let frame: number | undefined
    let disposed = false
    const changed =
      root.classList.contains('dark') !== dark ||
      root.style.colorScheme !== scheme ||
      currentBackground.current !== background
    const request =
      (changed || currentRequest.current !== null) && native ? crypto.randomUUID() : null
    currentRequest.current = request
    const updateNativeTheme = (transitionId?: string) =>
      native ? setWindowTheme(nativeTheme, transitionId, background) : setWindowTheme(nativeTheme)
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
      if (native && background !== 'solid') root.setAttribute('data-native-backdrop', background)
      else root.removeAttribute('data-native-backdrop')
      currentBackground.current = background
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
      void updateNativeTheme(request).then(apply, (reason: unknown) => {
        console.warn('Unable to update the native window theme:', reason)
        apply()
      })
    } else {
      apply()
      void updateNativeTheme().catch((reason: unknown) => {
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
    }
  }, [dark, nativeTheme, background])

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
