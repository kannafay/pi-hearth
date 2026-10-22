import { useLayoutEffect, useRef, useState } from 'react'
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels'

export function useAnimatedPanel(open: boolean, expandedSize: number) {
  const panelRef = useRef<PanelImperativeHandle | null>(null)
  const elementRef = useRef<HTMLDivElement | null>(null)
  const [defaultSize] = useState(() => (open ? `${expandedSize}px` : '0px'))
  const previousOpen = useRef(open)
  const lastExpandedSize = useRef(expandedSize)
  const groupRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const element = elementRef.current
    if (element && !element.style.getPropertyValue('--workspace-panel-width'))
      element.style.setProperty('--workspace-panel-width', `${expandedSize}px`)

    if (previousOpen.current === open) return
    previousOpen.current = open
    const panel = panelRef.current
    const group = elementRef.current?.parentElement
    if (!panel || !group) return

    if (timerRef.current !== null) clearTimeout(timerRef.current)
    groupRef.current = group
    group.setAttribute('data-panel-animating', '')
    if (open) {
      panel.resize(`${lastExpandedSize.current}px`)
    } else panel.collapse()

    // Keep transitions limited to toggles so separator dragging stays immediate.
    timerRef.current = setTimeout(() => {
      group.removeAttribute('data-panel-animating')
      timerRef.current = null
      if (open && element && element.offsetWidth > 0) {
        lastExpandedSize.current = element.offsetWidth
        element.style.setProperty('--workspace-panel-width', `${element.offsetWidth}px`)
      }
    }, 220)
  }, [open, expandedSize])

  useLayoutEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      groupRef.current?.removeAttribute('data-panel-animating')
    },
    [],
  )

  function onResize({ inPixels }: PanelSize) {
    // Reveal a stable-width panel rather than wrapping its contents as it closes.
    const element = elementRef.current
    if (inPixels > 0 && !element?.parentElement?.hasAttribute('data-panel-animating')) {
      lastExpandedSize.current = inPixels
      element?.style.setProperty('--workspace-panel-width', `${inPixels}px`)
    }
  }

  return { panelRef, elementRef, defaultSize, onResize }
}
