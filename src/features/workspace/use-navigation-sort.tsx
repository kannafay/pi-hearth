import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { NavigationKind, SortEdge } from '@/lib/navigation-order'

type Move = (kind: NavigationKind, source: string, target: string, edge: SortEdge) => boolean
type Preview = { label: string; left: number; top: number; width: number }
const itemSelector = '[data-sort-kind]'

function compatible(source: HTMLElement, target: HTMLElement) {
  return (
    source.dataset.sortKind === target.dataset.sortKind &&
    source.dataset.sortGroup === target.dataset.sortGroup &&
    source.dataset.sortPinned === target.dataset.sortPinned
  )
}

export function useNavigationSort(enabled: boolean, move: Move) {
  const descriptionId = useId()
  const rootRef = useRef<HTMLElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const suppressClick = useRef(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    if (!enabled) cleanupRef.current?.()
    return () => cleanupRef.current?.()
  }, [enabled])

  function onPointerDownCapture(event: PointerEvent<HTMLElement>) {
    suppressClick.current = false
    if (!enabled || event.button !== 0 || event.pointerType === 'touch') return
    const handle = (event.target as Element).closest<HTMLElement>('[data-sort-handle]')
    const source = handle?.closest<HTMLElement>(itemSelector)
    const root = rootRef.current
    if (!handle || !source || !root || handle.matches(':disabled, [aria-disabled="true"]')) return
    cleanupRef.current?.()
    const startX = event.clientX
    const startY = event.clientY
    const bounds = handle
      .closest<HTMLElement>('.sidebar-project-row, .sidebar-session-row')!
      .getBoundingClientRect()
    const pointerId = event.pointerId
    const label = handle.textContent?.trim() || ''
    let x = startX
    let y = startY
    let dragging = false
    let target: HTMLElement | null = null
    let edge: SortEdge = 'before'
    let frame = 0
    const viewport = root.querySelector<HTMLElement>('[data-sidebar-tab-content]')

    function locateTarget() {
      target?.removeAttribute('data-sort-edge')
      const hit = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>(`[data-sort-kind="${source!.dataset.sortKind}"]`)
      target = hit && root!.contains(hit) && hit !== source && compatible(source!, hit) ? hit : null
      root!.dataset.sortInvalid =
        hit && hit !== source && !compatible(source!, hit) ? 'true' : 'false'
      if (target) {
        const box = target.getBoundingClientRect()
        edge = y < box.top + box.height / 2 ? 'before' : 'after'
        target.dataset.sortEdge = edge
      }
    }

    function scroll() {
      if (viewport) {
        const box = viewport.getBoundingClientRect()
        const speed =
          y < box.top + 32
            ? -Math.min(12, (box.top + 32 - y) / 3)
            : y > box.bottom - 32
              ? Math.min(12, (y - box.bottom + 32) / 3)
              : 0
        if (speed && x >= box.left && x <= box.right) {
          viewport.scrollTop += speed
          locateTarget()
        }
      }
      frame = requestAnimationFrame(scroll)
    }

    function cleanup() {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointermove', update)
      document.removeEventListener('pointerup', release)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', cancel)
      if (handle!.hasPointerCapture?.(pointerId)) handle!.releasePointerCapture(pointerId)
      source!.removeAttribute('data-sort-dragging')
      target?.removeAttribute('data-sort-edge')
      root!.removeAttribute('data-navigation-sorting')
      root!.removeAttribute('data-sort-invalid')
      cleanupRef.current = null
      setPreview(null)
    }

    function update(next: globalThis.PointerEvent) {
      if (next.pointerId !== pointerId) return
      x = next.clientX
      y = next.clientY
      if (!dragging && Math.hypot(x - startX, y - startY) < 6) return
      next.preventDefault()
      if (!dragging) {
        dragging = true
        suppressClick.current = true
        handle!.setPointerCapture?.(pointerId)
        source!.dataset.sortDragging = 'true'
        root!.dataset.navigationSorting = 'true'
        setPreview({
          label,
          left: bounds.left + x - startX,
          top: bounds.top + y - startY,
          width: bounds.width,
        })
        setAnnouncement(`正在移动${label}，只能在同一置顶分区内排序。`)
        frame = requestAnimationFrame(scroll)
      }
      if (previewRef.current) {
        previewRef.current.style.left = `${bounds.left + x - startX}px`
        previewRef.current.style.top = `${bounds.top + y - startY}px`
      }
      locateTarget()
    }

    function release(next: globalThis.PointerEvent) {
      if (next.pointerId !== pointerId) return
      if (dragging) {
        x = next.clientX
        y = next.clientY
        locateTarget()
        suppressClick.current = true
        const changed =
          target &&
          move(
            source!.dataset.sortKind as NavigationKind,
            source!.dataset.sortPath!,
            target.dataset.sortPath!,
            edge,
          )
        setAnnouncement(changed ? `${label}排序已更新。` : '未更改排序。')
        setTimeout(() => {
          suppressClick.current = false
        }, 0)
      }
      cleanup()
    }
    function cancel() {
      if (dragging) setAnnouncement('已取消排序。')
      cleanup()
    }
    function escape(next: globalThis.KeyboardEvent) {
      if (next.key === 'Escape') {
        next.preventDefault()
        next.stopPropagation()
        cancel()
      }
    }
    cleanupRef.current = cleanup
    document.addEventListener('pointermove', update, { passive: false })
    document.addEventListener('pointerup', release)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('blur', cancel)
  }

  function onKeyDownCapture(event: KeyboardEvent<HTMLElement>) {
    if (!enabled || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    const handle = (event.target as Element).closest('[data-sort-handle]')
    const source = handle?.closest<HTMLElement>(itemSelector)
    if (!source) return
    event.preventDefault()
    event.stopPropagation()
    const peers = [...rootRef.current!.querySelectorAll<HTMLElement>(itemSelector)].filter((item) =>
      compatible(source, item),
    )
    const target = peers[peers.indexOf(source) + (event.key === 'ArrowUp' ? -1 : 1)]
    if (
      target &&
      move(
        source.dataset.sortKind as NavigationKind,
        source.dataset.sortPath!,
        target.dataset.sortPath!,
        event.key === 'ArrowUp' ? 'before' : 'after',
      )
    ) {
      setAnnouncement(`${handle!.textContent?.trim()}排序已更新。`)
    }
  }

  return {
    rootRef,
    descriptionId,
    sorting: Boolean(preview),
    preview,
    previewRef,
    announcement,
    onPointerDownCapture,
    onKeyDownCapture,
    onClickCapture(event: React.MouseEvent) {
      if (suppressClick.current) {
        suppressClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }
    },
  }
}
