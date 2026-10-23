import { useLayoutEffect } from 'react'

export function useWindowResizeMotion() {
  useLayoutEffect(() => {
    const root = document.documentElement
    let timer: ReturnType<typeof setTimeout> | undefined
    const resize = () => {
      root.setAttribute('data-window-resizing', '')
      clearTimeout(timer)
      timer = setTimeout(() => root.removeAttribute('data-window-resizing'), 200)
    }
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      clearTimeout(timer)
      root.removeAttribute('data-window-resizing')
    }
  }, [])
}
