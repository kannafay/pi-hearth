import { createContext, useContext, useEffect, useRef } from 'react'
import { useConversationLocalState } from './conversation-local-state'

export const ExecutionInspection = createContext<(() => void) | null>(null)

export function useExecutionRecord(
  key: string,
  phase: 'pending' | 'active' | 'approval' | 'finished',
  behavior: 'streaming' | 'details' = 'streaming',
) {
  const [choice, setChoice] = useConversationLocalState<{
    phase: typeof phase
    open: boolean
  } | null>(key, null)
  const inspect = useContext(ExecutionInspection)
  const automatic = phase === 'approval' || (behavior === 'streaming' && phase === 'active')
  const [entered, setEntered] = useConversationLocalState(`${key}:entered`, !automatic)
  useEffect(() => {
    if (entered) return
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [entered, setEntered])
  // Tool detail choices outlive status changes. Approval temporarily forces them open.
  // Streaming sections still close when their content stops being produced.
  const open =
    phase === 'approval'
      ? entered
      : behavior === 'details' && choice
        ? choice.open
        : choice?.phase === phase
          ? choice.open
          : automatic && entered
  const headerRef = useRef<HTMLButtonElement>(null)

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) inspect?.()
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
