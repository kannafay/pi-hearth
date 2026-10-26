import { memo, useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'
import { ScrollArea } from '@/components/scroll-area'
import { useConversationStore } from './store'
import { Composer } from './composer'
import type { ComposerActions } from './composer-commands'
import { createConversationViewSelector } from './conversation-turns'
import { ConversationTurn } from './conversation-turn'
import { ConversationWelcome } from './conversation-welcome'
import { ConversationLocalState } from './conversation-local-state'
import { sessionCacheKey, type ConversationViewState } from './session-cache'

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
  session,
  view,
}: {
  controller: RefObject<ScrollController | null>
  onActionStart: () => void
  session: string
  view: ConversationViewState
}) {
  const ids = useConversationStore((state) => selectView(state).ids)
  const viewport = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [readingDisclosure, setReadingDisclosure] = useState(false)
  const userScrolling = useRef(false)
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
    anchorTo: readingDisclosure ? 'start' : 'end',
    followOnAppend: true,
    scrollEndThreshold: 80,
    directDomUpdates: true,
    // Translated rows offset sticky execution headers away from the scroll viewport.
    directDomUpdatesMode: 'position',
    // Streaming and animated process panels can resize in the same observer cycle.
    useAnimationFrameWithResizeObserver: true,
    rangeExtractor,
    enabled: ids.length > 0,
    initialOffset: view.offset ?? 0,
    initialMeasurementsCache: view.measurements,
  })

  useLayoutEffect(() => {
    const current = {
      toEnd: () => {
        setReadingDisclosure(false)
        virtualizer.scrollToEnd()
      },
    }
    controller.current = current
    return () => {
      if (controller.current === current) controller.current = null
    }
  }, [controller, virtualizer])

  useLayoutEffect(() => {
    if (ids.length && !initialized.current) {
      initialized.current = true
      if (view.offset !== undefined && !view.atEnd) virtualizer.scrollToOffset(view.offset)
      else virtualizer.scrollToEnd()
    }
  }, [ids, virtualizer, view])

  useLayoutEffect(() => {
    const node = viewport.current
    return () => {
      if (!node || !initialized.current) return
      useConversationStore.getState().saveSessionView(session, {
        offset: node.scrollTop,
        atEnd: node.scrollHeight - node.scrollTop - node.clientHeight <= 80,
        measurements: virtualizer.takeSnapshot(),
        localState: view.localState,
      })
    }
  }, [session, virtualizer, view])

  return (
    <ScrollArea
      ref={viewport}
      role="log"
      aria-label="对话消息"
      aria-live="off"
      className="min-h-0 flex-1"
      viewportClassName="h-full overflow-x-hidden overflow-y-auto px-6"
      style={{ overflowAnchor: 'none' }}
      onClickCapture={(event) => {
        if (!(event.target as HTMLElement).closest('[data-slot="collapsible-trigger"]')) return
        // Manual disclosure changes keep the reader's position instead of following the new end.
        userScrolling.current = false
        virtualizer.cancelScroll()
        setReadingDisclosure(true)
      }}
      onWheel={() => {
        userScrolling.current = true
        virtualizer.cancelScroll()
      }}
      onTouchStart={() => {
        userScrolling.current = true
        virtualizer.cancelScroll()
      }}
      onScroll={() => {
        if (readingDisclosure && userScrolling.current && virtualizer.isAtEnd())
          setReadingDisclosure(false)
      }}
      onKeyDown={(event) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
          userScrolling.current = true
          virtualizer.cancelScroll()
        }
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
              className="absolute left-0 w-full pb-8"
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

function ConversationView({
  session,
  controller,
  onActionStart,
}: {
  session: string
  controller: RefObject<ScrollController | null>
  onActionStart: () => void
}) {
  const [view] = useState<ConversationViewState>(
    () =>
      useConversationStore.getState().sessionCache.get(session)?.view ?? {
        atEnd: true,
        measurements: [],
        localState: new Map(),
      },
  )
  return (
    <ConversationLocalState initial={view.localState}>
      <ConversationMessages
        session={session}
        view={view}
        controller={controller}
        onActionStart={onActionStart}
      />
    </ConversationLocalState>
  )
}

export const ConversationPanel = memo(function ConversationPanel({
  onCreateProject,
  ...actions
}: {
  onCreateProject?: () => void
} & ComposerActions) {
  const session = useConversationStore((state) =>
    state.connectionTarget?.sessionPath === null && !state.messages.length && !state.tools.length
      ? null
      : sessionCacheKey(state),
  )
  const controller = useRef<ScrollController | null>(null)
  const toEnd = useCallback(() => controller.current?.toEnd(), [])
  return (
    <>
      <ConversationView
        key={session ?? 'new'}
        session={session ?? 'new'}
        controller={controller}
        onActionStart={toEnd}
      />
      <Composer onSendStart={toEnd} onCreateProject={onCreateProject} {...actions} />
    </>
  )
})
