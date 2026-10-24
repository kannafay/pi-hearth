import { useImperativeHandle, useRef, type ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAnimatedPanel } from './use-animated-panel'
import { usePanelPresentation } from './use-panel-presentation'

const motions: {
  node: Element
  frames: Keyframe[]
  options: KeyframeAnimationOptions
  cancel: ReturnType<typeof vi.fn>
}[] = []
const originalAnimate = Element.prototype.animate

beforeEach(() => {
  vi.useFakeTimers()
  motions.length = 0
  Element.prototype.animate = vi.fn(function (
    this: Element,
    frames: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    const cancel = vi.fn()
    motions.push({
      node: this,
      frames: frames as Keyframe[],
      options: options as KeyframeAnimationOptions,
      cancel,
    })
    return { cancel } as unknown as Animation
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  Element.prototype.animate = originalAnimate
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function renderPresentation(initialDocked: boolean, side: 'left' | 'right' = 'left') {
  let docked = initialDocked
  let open = true
  let floatingOpen = !initialDocked
  let pixels = initialDocked ? 352 : 0
  const controller = {
    collapse: vi.fn(() => {
      pixels = 0
    }),
    expand: vi.fn(),
    resize: vi.fn((size: number | string) => {
      pixels = Number.parseFloat(String(size))
    }),
    getSize: () => ({ inPixels: pixels, asPercentage: 25 }),
    isCollapsed: () => pixels === 0,
  }

  function PanelFrame({
    elementRef,
    panelRef,
    children,
  }: Pick<ReturnType<typeof useAnimatedPanel>, 'elementRef' | 'panelRef'> & {
    children: ReactNode
  }) {
    useImperativeHandle(panelRef, () => controller)
    return <div ref={elementRef}>{children}</div>
  }

  function Preview() {
    const frame = useRef<HTMLDivElement | null>(null)
    const host = usePanelPresentation({ docked, open, floatingOpen, side, elementRef: frame })
    const panel = useAnimatedPanel(open, 352, docked, frame)
    const controls = <nav data-testid="shared-controls">同一套面板内容</nav>
    return (
      <div data-testid="layout">
        <PanelFrame elementRef={frame} panelRef={panel.panelRef}>
          <div className="workspace-panel-content" data-testid="frame" inert={!docked}>
            {host && controls}
          </div>
        </PanelFrame>
        <div className="workspace-content-inset" />
        <div data-testid="floating" data-open={!docked && floatingOpen}>
          {!host && controls}
        </div>
      </div>
    )
  }

  const view = render(<Preview />)
  const frame = screen.getByTestId('frame')
  vi.spyOn(frame.parentElement!, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 40, 352, 700),
  )
  const update = () => view.rerender(<Preview />)
  return {
    frame,
    controller,
    unmount: view.unmount,
    placement: (next: boolean) => {
      docked = next
      floatingOpen = !next
      update()
    },
    close: () => {
      open = false
      floatingOpen = false
      update()
    },
  }
}

test('responsive exit collapses layout immediately and retains exactly one inert controls view for 140ms', () => {
  const panel = renderPresentation(true)
  panel.placement(false)
  expect(panel.controller.collapse).toHaveBeenCalledOnce()
  expect(screen.getByTestId('layout')).not.toHaveAttribute('data-panel-animating')
  expect(panel.frame).toHaveAttribute('data-responsive-exit', 'left')
  expect(panel.frame).toHaveAttribute('inert')
  expect(panel.frame).toContainElement(screen.getByTestId('shared-controls'))
  expect(screen.getAllByTestId('shared-controls')).toHaveLength(1)
  expect(motions[0].options.duration).toBe(140)
  expect(motions[0].frames.every((frame) => !('width' in frame) && !('flexGrow' in frame))).toBe(
    true,
  )
  act(() => vi.advanceTimersByTime(139))
  expect(panel.frame).toContainElement(screen.getByTestId('shared-controls'))
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByTestId('floating')).toContainElement(screen.getByTestId('shared-controls'))
  expect(screen.getAllByTestId('shared-controls')).toHaveLength(1)
  expect(panel.frame).not.toHaveAttribute('data-responsive-exit')
})

test('fixed layout restores its pixels before the floating exit finishes and then fades in the shared controls', () => {
  const panel = renderPresentation(false, 'right')
  panel.placement(true)
  act(() => vi.advanceTimersByTime(32))
  expect(panel.controller.resize).toHaveBeenLastCalledWith('352px')
  expect(screen.getByTestId('floating')).toContainElement(screen.getByTestId('shared-controls'))
  act(() => vi.advanceTimersByTime(108))
  expect(panel.frame).toContainElement(screen.getByTestId('shared-controls'))
  expect(screen.getAllByTestId('shared-controls')).toHaveLength(1)
  expect(motions.at(-1)?.frames[0]).toMatchObject({ opacity: '0', transform: 'translateX(6px)' })
})

test('exit keeps the content width even before the resized group has recomputed its pixel basis', () => {
  const panel = renderPresentation(true)
  vi.mocked(panel.frame.parentElement!.getBoundingClientRect).mockReturnValue(
    new DOMRect(0, 40, 238, 700),
  )
  vi.spyOn(panel.frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 352, 700))
  panel.placement(false)
  expect(panel.frame.style.getPropertyValue('--responsive-panel-width')).toBe('352px')
  expect(motions.find((motion) => motion.frames[0]?.clipPath)?.frames[0].clipPath).toBe(
    'inset(0 0 0 352px)',
  )
})

test('a quick breakpoint reversal cancels the obsolete exit without duplicating or losing controls', () => {
  const panel = renderPresentation(true)
  panel.placement(false)
  act(() => vi.advanceTimersByTime(50))
  panel.placement(true)
  expect(panel.frame).not.toHaveAttribute('data-responsive-exit')
  expect(motions[0].cancel).toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(200))
  expect(panel.frame).toContainElement(screen.getByTestId('shared-controls'))
  expect(screen.getAllByTestId('shared-controls')).toHaveLength(1)
})

test('a new collapse during entry is not blocked by the entry animation timer', () => {
  const panel = renderPresentation(false, 'right')
  panel.placement(true)
  act(() => vi.advanceTimersByTime(150))
  panel.placement(false)
  act(() => vi.advanceTimersByTime(140))
  expect(screen.getByTestId('floating')).toContainElement(screen.getByTestId('shared-controls'))
  expect(screen.getAllByTestId('shared-controls')).toHaveLength(1)
})

test('closing the panel during a floating-to-fixed handoff does not replay a stale entry', () => {
  const panel = renderPresentation(false, 'right')
  panel.placement(true)
  act(() => vi.advanceTimersByTime(50))
  panel.close()
  act(() => vi.advanceTimersByTime(200))
  expect(motions).toHaveLength(0)
  expect(panel.frame).toContainElement(screen.getByTestId('shared-controls'))
})

test('reduced motion hands off immediately without decorative animation', () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
  const panel = renderPresentation(true)
  panel.placement(false)
  expect(screen.getByTestId('floating')).toContainElement(screen.getByTestId('shared-controls'))
  expect(motions).toHaveLength(0)
  expect(panel.frame).not.toHaveAttribute('data-responsive-exit')
})

test('unmounting an outgoing panel cancels its animations and pending handoff', () => {
  const panel = renderPresentation(true)
  panel.placement(false)
  expect(motions.length).toBeGreaterThan(0)
  panel.unmount()
  expect(motions.every((motion) => motion.cancel.mock.calls.length > 0)).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
