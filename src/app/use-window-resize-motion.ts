import { useLayoutEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDesktop } from '@/lib/desktop'

export function useWindowResizeMotion() {
  useLayoutEffect(() => {
    const root = document.documentElement
    let timer: ReturnType<typeof setTimeout> | undefined
    let viewportRequest = 0
    const clearViewport = () => {
      for (const axis of ['width', 'height']) root.style.removeProperty(`--window-overflow-${axis}`)
    }
    const syncViewport = async () => {
      if (!isDesktop()) return
      const request = ++viewportRequest
      try {
        const size = await getCurrentWindow().innerSize()
        if (request !== viewportRequest) return
        const scale = window.devicePixelRatio
        const viewport = window.visualViewport
        // WebView2 can round its viewport beyond the native client area at fractional DPI.
        for (const [axis, extent] of [
          ['width', viewport?.width ?? window.innerWidth],
          ['height', viewport?.height ?? window.innerHeight],
        ] as const) {
          const overflow = Math.max(0, Math.round(extent * scale) - size[axis]) / scale
          root.style.setProperty(`--window-overflow-${axis}`, `${overflow}px`)
        }
      } catch {
        if (request === viewportRequest) clearViewport()
      }
    }
    const resize = () => {
      if (!root.hasAttribute('data-window-resizing')) root.setAttribute('data-window-resizing', '')
      void syncViewport()
      clearTimeout(timer)
      timer = setTimeout(() => root.removeAttribute('data-window-resizing'), 200)
    }
    void syncViewport()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      clearTimeout(timer)
      viewportRequest++
      clearViewport()
      root.removeAttribute('data-window-resizing')
    }
  }, [])
}
