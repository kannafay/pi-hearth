import { useEffect, useRef } from 'react'
import { useConversationLocalState } from './conversation-local-state'

export function useExecutionRecord(
  key: string,
  phase: 'pending' | 'active' | 'approval' | 'finished',
) {
  const [choice, setChoice] = useConversationLocalState<{
    phase: typeof phase
    open: boolean
  } | null>(key, null)
  const automatic = phase === 'approval'
  const [entered, setEntered] = useConversationLocalState(`${key}:entered`, !automatic)
  useEffect(() => {
    if (entered) return
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [entered, setEntered])
  // Details open on request. Approval can temporarily force its decision panel open.
  const open = phase === 'approval' ? entered : (choice?.open ?? false)
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
    setChoice({ phase, open: nextOpen })
  }

  return [open, changeOpen, headerRef] as const
}
