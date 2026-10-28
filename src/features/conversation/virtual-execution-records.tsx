import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import type { ProcessItem } from './conversation-turns'
import { useConversationLocalCache } from './conversation-local-state'

export function VirtualExecutionRecords({
  items,
  stateKey,
  children,
}: {
  items: ProcessItem[]
  stateKey?: string
  children: (item: ProcessItem) => ReactNode
}) {
  const cache = useConversationLocalCache()
  const cacheKey = stateKey ? `process:${stateKey}:measurements` : undefined
  const [measurements] = useState(() =>
    cacheKey ? ((cache?.get(cacheKey) as VirtualItem[] | undefined) ?? []) : [],
  )
  const list = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<{ viewport: HTMLElement | null; margin: number } | null>(
    null,
  )
  const [focused, setFocused] = useState<string | null>(null)
  const focusedIndex = focused === null ? -1 : items.findIndex((item) => item.id === focused)
  const getItemKey = useCallback((index: number) => items[index].id, [items])
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const visible = defaultRangeExtractor(range)
      if (focusedIndex >= 0 && !visible.includes(focusedIndex)) visible.push(focusedIndex)
      return visible.sort((a, b) => a - b)
    },
    [focusedIndex],
  )
  const attach = useCallback((element: HTMLDivElement | null) => {
    list.current = element
    if (!element) return
    const viewport = element.closest<HTMLElement>('[data-scroll-area], [role="log"]')
    setLayout({
      viewport,
      margin: viewport
        ? element.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop -
          viewport.clientTop
        : 0,
    })
  }, [])

  // Share the conversation's scroll viewport; an archive never creates another scroll pane.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => layout?.viewport ?? null,
    getItemKey,
    estimateSize: (index) => {
      const item = items[index]
      // Progress notes can be much taller than folded tool/thinking headers.
      return item.kind === 'message'
        ? Math.min(2000, Math.max(48, Math.ceil(item.message.text.length / 80) * 24))
        : 33
    },
    gap: 4,
    paddingStart: 4,
    overscan: 4,
    scrollMargin: layout?.margin ?? 0,
    rangeExtractor,
    initialMeasurementsCache: measurements,
    enabled: !!layout?.viewport,
  })

  useLayoutEffect(() => {
    const element = list.current
    const viewport = layout?.viewport
    if (!element || !viewport) return
    const update = () => {
      const margin =
        element.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top +
        viewport.scrollTop -
        viewport.clientTop
      setLayout((previous) =>
        previous && Math.abs(previous.margin - margin) < 0.5 ? previous : { viewport, margin },
      )
    }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(viewport)
    if (element.parentElement) resize?.observe(element.parentElement)
    const turn = element.closest('[data-turn-id]')
    if (turn) resize?.observe(turn)
    const position = new MutationObserver(update)
    // The outer virtualizer positions turns directly. Position changes do not fire ResizeObserver.
    if (turn) position.observe(turn, { attributes: true, attributeFilter: ['style'] })
    return () => {
      resize?.disconnect()
      position.disconnect()
    }
  }, [layout?.viewport])

  useLayoutEffect(
    () => () => {
      if (cacheKey) cache?.set(cacheKey, virtualizer.takeSnapshot())
    },
    [cache, cacheKey, virtualizer],
  )

  return (
    <div
      ref={attach}
      role="region"
      aria-label="执行过程详情"
      data-virtual-execution-records
      className="relative min-w-0"
      style={{
        height: layout?.viewport
          ? virtualizer.getTotalSize()
          : layout
            ? undefined
            : items.length * 37,
      }}
      onFocusCapture={(event) =>
        setFocused(
          (event.target as HTMLElement).closest<HTMLElement>('[data-process-item]')?.dataset
            .processItem ?? null,
        )
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null)
      }}
    >
      {layout && !layout.viewport
        ? items.map(children)
        : virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              data-process-item={items[row.index].id}
              className="absolute left-0 w-full min-w-0"
              // Positioning preserves the existing sticky record headers.
              style={{ top: row.start - (layout?.margin ?? 0) }}
            >
              {children(items[row.index])}
            </div>
          ))}
    </div>
  )
}
