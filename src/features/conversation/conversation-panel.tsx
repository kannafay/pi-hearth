import { memo, useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'
import { ScrollArea } from '@/components/scroll-area'
import { useConversationStore } from './store'
import { Composer } from './composer'
import { createConversationViewSelector } from './conversation-turns'
import { ConversationTurn } from './conversation-turn'
import { ConversationWelcome } from './conversation-welcome'
import { ConversationLocalState } from './conversation-local-state'

const selectView = createConversationViewSelector()
type ScrollController = { toEnd: () => void }

const ConversationRow = memo(function ConversationRow({
  id,
  last,
  onActionStart,
}: {
  id: string
  last: boolean
  onActionStart: () => void
}) {
  const { turn, active } = useConversationStore(
    useShallow((state) => {
      const turn = selectView(state).turns.get(id)
      const busy = state.status === 'running' || state.status === 'stopping'
      const active = Boolean(
        turn &&
        busy &&
        (turn.user?.id === `${state.activeRunId}-user` ||
          turn.process.some(
            (item) => item.kind === 'tool' && item.tool.runId === state.activeRunId,
          ) ||
          (last && turn.lastAssistant?.status === 'streaming')),
      )
      return { turn, active }
    }),
  )
  return turn ? (
    <ConversationTurn turn={turn} active={active} onActionStart={onActionStart} />
  ) : null
})

const ConversationMessages = memo(function ConversationMessages({
  controller,
  onActionStart,
}: {
  controller: RefObject<ScrollController | null>
  onActionStart: () => void
}) {
  const ids = useConversationStore((state) => selectView(state).ids)
  const viewport = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const initialized = useRef(false)
  const getItemKey = useCallback((index: number) => ids[index], [ids])
  const focusedIndex = focused === null ? -1 : ids.indexOf(focused)
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const visible = defaultRangeExtractor(range)
      // Keep the focused editor/control mounted when the reader scrolls away.
      if (focusedIndex >= 0 && !visible.includes(focusedIndex)) visible.push(focusedIndex)
      return visible.sort((a, b) => a - b)
    },
    [focusedIndex],
  )
  // The mutable instance stays local; memoized rows receive only stable data.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => viewport.current,
    getItemKey,
    estimateSize: () => 280,
    overscan: 3,
    paddingStart: 32,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 80,
    directDomUpdates: true,
    // Streaming and animated process panels can resize in the same observer cycle.
    useAnimationFrameWithResizeObserver: true,
    rangeExtractor,
    enabled: ids.length > 0,
  })

  useLayoutEffect(() => {
    const current = { toEnd: () => virtualizer.scrollToEnd() }
    controller.current = current
    return () => {
      if (controller.current === current) controller.current = null
    }
  }, [controller, virtualizer])

  useLayoutEffect(() => {
    if (ids.length && !initialized.current) {
      initialized.current = true
      virtualizer.scrollToEnd()
    }
  }, [ids, virtualizer])

  return (
    <ScrollArea
      ref={viewport}
      role="log"
      aria-label="对话消息"
      aria-live="off"
      className="min-h-0 flex-1"
      viewportClassName="h-full overflow-x-hidden overflow-y-auto px-6"
      style={{ overflowAnchor: 'none' }}
      onWheel={() => virtualizer.cancelScroll()}
      onTouchStart={() => virtualizer.cancelScroll()}
      onKeyDown={(event) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key))
          virtualizer.cancelScroll()
      }}
      onFocusCapture={(event) => {
        setFocused(
          (event.target as HTMLElement).closest<HTMLElement>('[data-turn-id]')?.dataset.turnId ??
            null,
        )
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null)
      }}
    >
      {ids.length ? (
        <div
          ref={virtualizer.containerRef}
          data-conversation-list
          className="relative mx-auto w-full max-w-209"
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              data-turn-id={ids[item.index]}
              className="absolute top-0 left-0 w-full pb-8"
            >
              <ConversationRow
                id={ids[item.index]}
                last={item.index === ids.length - 1}
                onActionStart={onActionStart}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="h-full py-8">
          <ConversationWelcome />
        </div>
      )}
    </ScrollArea>
  )
})

export const ConversationPanel = memo(function ConversationPanel() {
  const session = useConversationStore((state) => state.sessionFile)
  const controller = useRef<ScrollController | null>(null)
  const toEnd = useCallback(() => controller.current?.toEnd(), [])
  return (
    <>
      <ConversationLocalState key={session ?? 'new'}>
        <ConversationMessages
          key={session ?? 'new'}
          controller={controller}
          onActionStart={toEnd}
        />
      </ConversationLocalState>
      <Composer onSendStart={toEnd} />
    </>
  )
})
