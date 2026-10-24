import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels'

export function useAnimatedPanel(
  open: boolean,
  expandedSize: number,
  docked = true,
  floatingOpen = false,
) {
  const panelRef = useRef<PanelImperativeHandle | null>(null)
  const elementRef = useRef<HTMLDivElement | null>(null)
  const [hostDocked, setHostDocked] = useState(docked)
  const visible = open && docked
  const [defaultSize] = useState(() => (visible ? `${expandedSize}px` : '0px'))
  const previous = useRef({ visible, docked, expandedSize, floatingOpen })
  const current = useRef({ visible, expandedSize })
  const groupRef = useRef<HTMLElement | null>(null)
  const detachedRef = useRef<HTMLElement | null>(null)
  const pendingHost = useRef<boolean | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameRef = useRef<number | null>(null)

  function finishMotion() {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    pendingHost.current = null
    groupRef.current?.removeAttribute('data-panel-animating')
    groupRef.current?.style.removeProperty('--panel-detached-width')
    const node = detachedRef.current
    if (node) {
      node.removeAttribute('data-panel-detached')
      for (const property of ['top', 'bottom', 'inset', 'width'])
        node.style.removeProperty(`--panel-detached-${property}`)
    }
    detachedRef.current = null
  }

  const scheduleRestore = useEffectEvent((afterCommit = false) => {
    if (!current.current.visible || frameRef.current !== null) return
    const restore = () => {
      frameRef.current = null
      const panel = panelRef.current
      const element = elementRef.current
      const group = element?.parentElement
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
  })

  useLayoutEffect(() => {
    const element = elementRef.current
    if (element && !element.style.getPropertyValue('--workspace-panel-width'))
      element.style.setProperty('--workspace-panel-width', `${expandedSize}px`)

    const before = previous.current
    current.current = { visible, expandedSize }
    previous.current = { visible, docked, expandedSize, floatingOpen }
    const panel = panelRef.current
    const group = element?.parentElement
    if (!panel || !group) return

    const placementChanged = before.docked !== docked
    const visibilityChanged = before.visible !== visible
    if (!visibilityChanged && !placementChanged && docked === hostDocked) {
      if (
        visible &&
        frameRef.current === null &&
        before.expandedSize !== expandedSize &&
        Math.abs(panel.getSize().inPixels - expandedSize) > 1
      )
        panel.resize(`${expandedSize}px`)
      return
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--panel-duration')
      .trim()
    const configuredDuration = Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000)
    const duration = reduced ? 0 : Number.isFinite(configuredDuration) ? configuredDuration : 140
    if (placementChanged || (visibilityChanged && pendingHost.current === null)) finishMotion()
    groupRef.current = group

    if (docked !== hostDocked && pendingHost.current === null) {
      const node = element?.querySelector<HTMLElement>('.workspace-panel-content')
      const rect = element?.getBoundingClientRect()
      const exiting = hostDocked ? before.visible && node && rect?.width : before.floatingOpen
      if (exiting && duration) {
        if (hostDocked && node && rect) {
          // Only detach the exiting frame. Its open/close styles are the same as a button toggle.
          const width = node.getBoundingClientRect().width || rect.width
          const side = node.dataset.side === 'right' ? 'right' : 'left'
          node.style.setProperty('--panel-detached-top', `${rect.top}px`)
          node.style.setProperty('--panel-detached-bottom', `${window.innerHeight - rect.bottom}px`)
          node.style.setProperty(
            '--panel-detached-inset',
            `${side === 'left' ? rect.left : window.innerWidth - rect.right}px`,
          )
          node.style.setProperty('--panel-detached-width', `${width}px`)
          group.style.setProperty('--panel-detached-width', `${width}px`)
          node.setAttribute('data-panel-detached', side)
          detachedRef.current = node
        }
        pendingHost.current = docked
        timerRef.current = setTimeout(() => {
          finishMotion()
          setHostDocked(docked)
        }, duration)
      } else setHostDocked(docked)
    }

    if (!visibilityChanged) return
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    const animateLayout =
      !placementChanged &&
      pendingHost.current === null &&
      duration > 0 &&
      !document.documentElement.hasAttribute('data-window-resizing')
    group.toggleAttribute('data-panel-animating', animateLayout)
    if (visible) {
      element?.style.setProperty('--workspace-panel-width', `${expandedSize}px`)
      if (animateLayout) panel.resize(`${expandedSize}px`)
      else {
        // Let the responsive tree commit its parent geometry before restoring pixels.
        scheduleRestore(true)
      }
    } else panel.collapse()

    if (!animateLayout) return
    // Keep transitions limited to toggles so separator dragging stays immediate.
    timerRef.current = setTimeout(() => {
      finishMotion()
      if (current.current.visible && element && element.offsetWidth > 0)
        element.style.setProperty('--workspace-panel-width', `${element.offsetWidth}px`)
    }, duration)
  }, [visible, docked, expandedSize, floatingOpen, hostDocked])

  useEffect(() => {
    const element = elementRef.current
    const group = element?.parentElement
    if (!group) return
    const observer = new ResizeObserver(() => scheduleRestore())
    observer.observe(group)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(
    () => () => {
      finishMotion()
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
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

  return { panelRef, elementRef, defaultSize, onResize, hostDocked }
}
