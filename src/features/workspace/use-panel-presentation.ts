import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

type PanelPlacement = {
  docked: boolean
  open: boolean
  floatingOpen: boolean
  side: 'left' | 'right'
  elementRef: RefObject<HTMLDivElement | null>
}

export function usePanelPresentation({
  docked,
  open,
  floatingOpen,
  side,
  elementRef,
}: PanelPlacement) {
  const [hostDocked, setHostDocked] = useState(docked)
  const previous = useRef({ docked, visible: docked ? open : floatingOpen })
  const transition = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingHost = useRef<boolean | null>(null)
  const animations = useRef<Animation[]>([])
  const outgoing = useRef<HTMLElement | null>(null)
  const enter = useRef(false)
  const from = useRef<{ opacity: string; transform: string } | null>(null)

  function timing() {
    const style = getComputedStyle(document.documentElement)
    return {
      duration: Number.parseFloat(style.getPropertyValue('--panel-responsive-duration')) || 140,
      easing: style.getPropertyValue('--panel-ease').trim() || 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards' as const,
    }
  }

  function clear() {
    if (transition.current !== null) clearTimeout(transition.current)
    transition.current = null
    pendingHost.current = null
    for (const animation of animations.current) animation.cancel()
    animations.current = []
    const node = outgoing.current
    if (node) {
      node.removeAttribute('data-responsive-exit')
      for (const property of ['top', 'bottom', 'inset', 'width'])
        node.style.removeProperty(`--responsive-panel-${property}`)
    }
    outgoing.current = null
  }

  useLayoutEffect(() => {
    const before = previous.current
    previous.current = { docked, visible: docked ? open : floatingOpen }
    if (docked === hostDocked) {
      if (pendingHost.current !== null) {
        const node = outgoing.current
        if (node) {
          const style = getComputedStyle(node)
          from.current = { opacity: style.opacity, transform: style.transform }
        }
        clear()
        enter.current = docked && open
      }
      if (hostDocked && !open && animations.current.length) clear()
      return
    }
    if (pendingHost.current !== null) return
    const node = elementRef.current?.querySelector<HTMLElement>('.workspace-panel-content')
    const visual = animations.current.length && node ? getComputedStyle(node) : null
    const start = {
      opacity: visual?.opacity || '1',
      transform: visual?.transform || 'translateX(0px)',
    }
    clear()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rect = elementRef.current?.getBoundingClientRect()
    if (!before.visible || reduced || (hostDocked && (!node?.animate || !rect?.width))) {
      enter.current = docked && open && !reduced
      setHostDocked(docked)
      return
    }

    const options = timing()
    if (hostDocked && node && rect) {
      const width = node.getBoundingClientRect().width || rect.width
      outgoing.current = node
      node.style.setProperty('--responsive-panel-top', `${rect.top}px`)
      node.style.setProperty('--responsive-panel-bottom', `${window.innerHeight - rect.bottom}px`)
      node.style.setProperty(
        '--responsive-panel-inset',
        `${side === 'left' ? rect.left : window.innerWidth - rect.right}px`,
      )
      node.style.setProperty('--responsive-panel-width', `${width}px`)
      node.setAttribute('data-responsive-exit', side)
      animations.current.push(
        node.animate(
          [start, { opacity: 0, transform: `translateX(${side === 'left' ? -6 : 6}px)` }],
          options,
        ),
      )
      if (side === 'left') {
        const content = elementRef.current?.parentElement?.querySelector<HTMLElement>(
          '.workspace-content-inset',
        )
        if (content?.animate)
          animations.current.push(
            content.animate(
              [{ clipPath: `inset(0 0 0 ${width}px)` }, { clipPath: 'inset(0 0 0 0px)' }],
              options,
            ),
          )
      }
    }
    pendingHost.current = docked
    transition.current = setTimeout(() => {
      clear()
      enter.current = docked && previous.current.visible
      setHostDocked(docked)
    }, options.duration)
  }, [docked, hostDocked, open, floatingOpen, side, elementRef])

  useLayoutEffect(() => {
    if (!enter.current || !hostDocked || !docked) return
    enter.current = false
    const node = elementRef.current?.querySelector<HTMLElement>('.workspace-panel-content')
    if (!node?.animate) return
    const animation = node.animate(
      [
        from.current ?? {
          opacity: '0',
          transform: `translateX(${side === 'left' ? -6 : 6}px)`,
        },
        { opacity: 1, transform: 'translateX(0px)' },
      ],
      timing(),
    )
    from.current = null
    animations.current.push(animation)
    transition.current = setTimeout(clear, timing().duration)
  }, [hostDocked, docked, side, elementRef])

  useLayoutEffect(() => clear, [])
  return hostDocked
}
