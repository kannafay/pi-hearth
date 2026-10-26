import { useRef } from 'react'
import { useConversationLocalState } from './conversation-local-state'

export function useExecutionRecord(key: string, initialOpen: boolean) {
  const [open, setOpen] = useConversationLocalState(key, initialOpen)
  const headerRef = useRef<HTMLButtonElement>(null)

  function changeOpen(nextOpen: boolean) {
    const header = headerRef.current
    if (!nextOpen && header && getComputedStyle(header).position === 'sticky') {
      const group = header.parentElement
      const viewport = header.closest<HTMLElement>('[data-scroll-area]')
      if (group && viewport) {
        // Keep the clicked header visible when its long section shrinks.
        const stuckOffset = header.getBoundingClientRect().top - group.getBoundingClientRect().top
        if (stuckOffset > 0) viewport.scrollTop = Math.max(0, viewport.scrollTop - stuckOffset)
      }
    }
    setOpen(nextOpen)
  }

  return [open, changeOpen, headerRef] as const
}
