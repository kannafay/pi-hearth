import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TabsTabActivationDirection } from '@base-ui/react/tabs'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

function animate(element: HTMLElement, frames: Keyframe[], duration: number) {
  return element.animate(frames, {
    duration,
    easing:
      getComputedStyle(element).getPropertyValue('--sidebar-motion-ease').trim() ||
      'cubic-bezier(0.26, 0, 0.18, 1)',
    fill: 'both',
  })
}

export function useNavigationTabs() {
  const [filter, setFilter] = useState('all')
  const [contentFilter, setContentFilter] = useState('all')
  const viewportRef = useRef<HTMLDivElement>(null)
  const positions = useRef<Record<string, number>>({})
  const displayed = useRef('all')
  const requested = useRef('all')
  const animation = useRef<Animation | null>(null)
  const enterPending = useRef<Keyframe | null>(null)

  function rememberScroll() {
    if (viewportRef.current) positions.current[displayed.current] = viewportRef.current.scrollTop
  }

  function enter(element: HTMLElement, from: Keyframe) {
    const incoming = animate(element, [from, { opacity: 1, transform: 'none' }], 180)
    animation.current = incoming
    void incoming.finished.then(
      () => {
        if (animation.current !== incoming) return
        animation.current = null
        incoming.cancel()
      },
      () => {},
    )
  }

  useLayoutEffect(() => {
    if (displayed.current !== contentFilter) {
      displayed.current = contentFilter
      if (viewportRef.current) viewportRef.current.scrollTop = positions.current[contentFilter] ?? 0
    }
    if (enterPending.current && viewportRef.current) {
      const from = enterPending.current
      enterPending.current = null
      animation.current?.cancel()
      enter(viewportRef.current, from)
    }
  }, [contentFilter])

  useEffect(() => {
    const media = window.matchMedia(reducedMotionQuery)
    const skipMotion = () => {
      if (!media.matches) return
      rememberScroll()
      animation.current?.cancel()
      animation.current = null
      enterPending.current = null
      setContentFilter(requested.current)
    }
    media.addEventListener('change', skipMotion)
    return () => {
      media.removeEventListener('change', skipMotion)
      animation.current?.cancel()
      animation.current = null
    }
  }, [])

  function selectFilter(next: string, direction: TabsTabActivationDirection) {
    if (requested.current === next) return
    rememberScroll()
    requested.current = next
    setFilter(next)
    const element = viewportRef.current
    const style = element && getComputedStyle(element)
    const from = { opacity: style?.opacity || '1', transform: style?.transform || 'none' }
    animation.current?.cancel()
    animation.current = null
    enterPending.current = null

    if (window.matchMedia(reducedMotionQuery).matches || !element?.animate) {
      setContentFilter(next)
    } else if (next === displayed.current) {
      enter(element, from)
    } else {
      const offset = direction === 'right' ? 12 : direction === 'left' ? -12 : 0
      const outgoing = animate(
        element,
        [from, { opacity: 0, transform: `translateX(${-offset}px)` }],
        60,
      )
      animation.current = outgoing
      void outgoing.finished.then(
        () => {
          if (animation.current !== outgoing || requested.current !== next) return
          rememberScroll()
          enterPending.current = { opacity: 0, transform: `translateX(${offset}px)` }
          setContentFilter(next)
        },
        () => {},
      )
    }
  }

  return {
    filter,
    contentFilter,
    leaving: filter !== contentFilter,
    viewportRef,
    rememberScroll,
    selectFilter,
  }
}
