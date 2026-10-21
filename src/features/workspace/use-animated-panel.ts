import { useLayoutEffect, useRef, useState } from 'react'
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels'

export function useAnimatedPanel(open: boolean, expandedSize: number) {
  const panelRef = useRef<PanelImperativeHandle | null>(null)
  const elementRef = useRef<HTMLDivElement | null>(null)
  const [defaultSize] = useState(() => (open ? `${expandedSize}px` : '0px'))
  const previousOpen = useRef(open)
  const hasExpanded = useRef(open)
  const groupRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    if (previousOpen.current === open) return
    previousOpen.current = open
    const panel = panelRef.current
    const group = elementRef.current?.parentElement
    if (!panel || !group) return

    if (timerRef.current !== null) clearTimeout(timerRef.current)
    groupRef.current = group
    group.setAttribute('data-panel-animating', '')
    if (open) {
      if (hasExpanded.current) panel.expand()
      else panel.resize(`${expandedSize}px`)
      hasExpanded.current = true
    } else panel.collapse()

    // Keep transitions limited to toggles so separator dragging stays immediate.
    timerRef.current = setTimeout(() => {
      group.removeAttribute('data-panel-animating')
      timerRef.current = null
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
    if (inPixels > 0)
      elementRef.current?.style.setProperty('--workspace-panel-width', `${inPixels}px`)
  }

  return { panelRef, elementRef, defaultSize, onResize }
}
