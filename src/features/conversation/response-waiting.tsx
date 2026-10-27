import { useLayoutEffect, useRef } from 'react'

export function ResponseWaiting({ text }: { text: string }) {
  const line = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = line.current
    if (!element) return
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      if (!bounds.width) return
      element.style.setProperty('--response-waiting-width', `${bounds.width}px`)
      element.style.setProperty(
        '--response-waiting-stripe',
        `${Math.min(96, Math.max(28, bounds.width * 0.55))}px`,
      )
      for (const part of element.querySelectorAll<HTMLElement>('.response-waiting-part')) {
        part.style.setProperty(
          '--response-waiting-offset',
          `${part.getBoundingClientRect().left - bounds.left}px`,
        )
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={line} role="status" aria-atomic="true" className="response-waiting">
      <span aria-hidden="true" className="response-waiting-part response-waiting-logo" />
      <span className="response-waiting-part response-waiting-text">{text}</span>
    </div>
  )
}
