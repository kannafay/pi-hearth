import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels'

export function useAnimatedPanel(open: boolean, expandedSize: number, docked = true) {
  const panelRef = useRef<PanelImperativeHandle | null>(null)
  const elementRef = useRef<HTMLDivElement | null>(null)
  const visible = open && docked
  const [defaultSize] = useState(() => (visible ? `${expandedSize}px` : '0px'))
  const previous = useRef({ visible, docked, expandedSize })
  const current = useRef({ visible, expandedSize })
  const groupRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameRef = useRef<number | null>(null)

  function scheduleRestore(afterCommit = false) {
    if (!current.current.visible || frameRef.current !== null) return
    const restore = () => {
      frameRef.current = null
      const panel = panelRef.current
      const group = elementRef.current?.parentElement
      if (
        !current.current.visible ||
        !panel ||
        group?.hasAttribute('data-panel-animating') ||
        group?.querySelector(':scope > [data-separator="active"]')
      )
        return
      const preferred = current.current.expandedSize
      if (Math.abs(panel.getSize().inPixels - preferred) > 1) panel.resize(`${preferred}px`)
    }
    frameRef.current = window.requestAnimationFrame(() => {
      if (afterCommit) frameRef.current = window.requestAnimationFrame(restore)
      else restore()
    })
  }

  useLayoutEffect(() => {
    const element = elementRef.current
    if (element && !element.style.getPropertyValue('--workspace-panel-width'))
      element.style.setProperty('--workspace-panel-width', `${expandedSize}px`)

    const before = previous.current
    current.current = { visible, expandedSize }
    previous.current = { visible, docked, expandedSize }
    if (before.visible === visible) {
      if (
        visible &&
        frameRef.current === null &&
        before.expandedSize !== expandedSize &&
        Math.abs((panelRef.current?.getSize().inPixels ?? expandedSize) - expandedSize) > 1
      )
        panelRef.current?.resize(`${expandedSize}px`)
      return
    }
    const panel = panelRef.current
    const group = elementRef.current?.parentElement
    if (!panel || !group) return

    if (timerRef.current !== null) clearTimeout(timerRef.current)
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    timerRef.current = null
    frameRef.current = null
    groupRef.current = group
    const animate =
      before.docked === docked && !document.documentElement.hasAttribute('data-window-resizing')
    group.toggleAttribute('data-panel-animating', animate)
    if (visible) {
      element?.style.setProperty('--workspace-panel-width', `${expandedSize}px`)
      if (animate) panel.resize(`${expandedSize}px`)
      else {
        // Let the responsive tree commit its parent geometry before restoring pixels.
        scheduleRestore(true)
      }
    } else panel.collapse()

    if (!animate) return
    // Keep transitions limited to toggles so separator dragging stays immediate.
    timerRef.current = setTimeout(() => {
      group.removeAttribute('data-panel-animating')
      timerRef.current = null
      if (current.current.visible && element && element.offsetWidth > 0)
        element.style.setProperty('--workspace-panel-width', `${element.offsetWidth}px`)
    }, 220)
  }, [visible, docked, expandedSize])

  useEffect(() => {
    const group = elementRef.current?.parentElement
    if (!group) return
    const observer = new ResizeObserver(() => scheduleRestore())
    observer.observe(group)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      groupRef.current?.removeAttribute('data-panel-animating')
    },
    [],
  )

  function onResize({ inPixels }: PanelSize) {
    // Reveal a stable-width panel rather than wrapping its contents as it closes.
    const element = elementRef.current
    if (visible && inPixels > 0 && !element?.parentElement?.hasAttribute('data-panel-animating')) {
      element?.style.setProperty('--workspace-panel-width', `${inPixels}px`)
    }
  }

  return { panelRef, elementRef, defaultSize, onResize }
}
