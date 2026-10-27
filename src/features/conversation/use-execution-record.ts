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
  const automatic = phase === 'active' || phase === 'approval'
  const [entered, setEntered] = useConversationLocalState(`${key}:entered`, !automatic)
  useEffect(() => {
    if (entered) return
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [entered, setEntered])
  // Manual choices last for this step's current phase, including virtual row remounts.
  // Mount automatic steps closed first so their first opening also animates.
  const open = choice?.phase === phase ? choice.open : automatic && entered
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
