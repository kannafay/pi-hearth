import { useImperativeHandle, useLayoutEffect, type ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAnimatedPanel } from './use-animated-panel'

let notifyGroupResize: () => void

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        notifyGroupResize = () => callback([], this as unknown as ResizeObserver)
      }
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  document.documentElement.style.removeProperty('--panel-duration')
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderPanel(
  initialOpen: boolean,
  initialWidth = 260,
  initialDocked = true,
  side: 'left' | 'right' = 'left',
) {
  let onPanelResize: ReturnType<typeof useAnimatedPanel>['onResize']
  let pixels = initialOpen && initialDocked ? initialWidth : 0
  let open = initialOpen
  let width = initialWidth
  let docked = initialDocked
  let floatingOpen = initialOpen && !initialDocked
  const controller = {
    collapse: vi.fn(),
    expand: vi.fn(),
    resize: vi.fn(),
    getSize: () => ({ inPixels: pixels, asPercentage: 25 }),
    isCollapsed: () => pixels === 0,
  }

  function PanelElement({
    panelRef,
    elementRef,
    children,
  }: Pick<ReturnType<typeof useAnimatedPanel>, 'panelRef' | 'elementRef'> & {
    children: ReactNode
  }) {
    useImperativeHandle(panelRef, () => controller)
    return (
      <div ref={elementRef} data-testid="panel">
        {children}
      </div>
    )
  }

  function Preview({ open, width, docked }: { open: boolean; width: number; docked: boolean }) {
    const { panelRef, elementRef, onResize, hostDocked } = useAnimatedPanel(
      open,
      width,
      docked,
      floatingOpen,
    )
    useLayoutEffect(() => {
      onPanelResize = onResize
    })
    const controls = <nav data-testid="shared-controls">同一套面板内容</nav>
    return (
      <div>
        <PanelElement panelRef={panelRef} elementRef={elementRef}>
          {hostDocked && (
            <div
              className="workspace-panel-content"
              data-side={side}
              data-panel-open={open && docked}
              inert={!open || !docked}
            >
              {controls}
            </div>
          )}
        </PanelElement>
        <div data-testid="floating">{!hostDocked && controls}</div>
      </div>
    )
  }

  const view = render(<Preview open={open} width={width} docked={docked} />)
  const element = screen.getByTestId('panel')
  Object.defineProperty(element, 'offsetWidth', { get: () => pixels })
  const update = () => view.rerender(<Preview open={open} width={width} docked={docked} />)
  const measure = (next: number) => {
    pixels = next
    act(() => onPanelResize({ inPixels: next, asPercentage: 25 }))
  }

  return {
    controller,
    element,
    unmount: view.unmount,
    toggle: (next: boolean) => {
      open = next
      floatingOpen = open && !docked
      update()
    },
    present: (next: boolean) => {
      docked = next
      floatingOpen = open && !docked
      update()
    },
    measure,
    groupResize: () => act(() => notifyGroupResize()),
    resize: (next: number) => {
      measure(next)
      width = next
      update()
    },
    contentWidth: () => element.style.getPropertyValue('--workspace-panel-width'),
  }
}

test('keeps content at its expanded width through collapse and a rapid reopening', () => {
  const panel = renderPanel(true)
  panel.resize(310)
  panel.toggle(false)
  panel.measure(120)
  expect(panel.contentWidth()).toBe('310px')

  act(() => vi.advanceTimersByTime(80))
  panel.toggle(true)
  panel.measure(55)
  act(() => vi.advanceTimersByTime(100))
  panel.measure(200)
  expect(panel.contentWidth()).toBe('310px')

  panel.measure(310)
  act(() => vi.advanceTimersByTime(140))
  panel.resize(340)
  expect(panel.contentWidth()).toBe('340px')
})

test('reopens at its last pixel width after the group resizes while collapsed', () => {
  const panel = renderPanel(true)
  panel.resize(314)
  panel.toggle(false)
  panel.measure(0)
  act(() => vi.advanceTimersByTime(260))

  panel.toggle(true)
  expect(panel.controller.resize).toHaveBeenLastCalledWith('314px')
  expect(panel.contentWidth()).toBe('314px')
})

test('uses an expanded content width on first opening and resyncs when settled', () => {
  const panel = renderPanel(false)
  panel.measure(0)
  expect(panel.contentWidth()).toBe('260px')

  panel.toggle(true)
  panel.measure(80)
  expect(panel.contentWidth()).toBe('260px')
  panel.measure(280)
  act(() => vi.advanceTimersByTime(260))
  expect(panel.contentWidth()).toBe('280px')
})

test('temporary constrained measurements never replace the preferred width across breakpoints', () => {
  const panel = renderPanel(true, 352)
  panel.measure(334)
  expect(panel.contentWidth()).toBe('334px')
  panel.present(false)
  panel.measure(0)
  expect(panel.element.parentElement).not.toHaveAttribute('data-panel-animating')
  expect(vi.getTimerCount()).toBe(0)

  panel.present(true)
  act(() => vi.advanceTimersByTime(32))
  expect(panel.controller.resize).toHaveBeenLastCalledWith('352px')
  expect(panel.contentWidth()).toBe('352px')
  expect(panel.element.parentElement).not.toHaveAttribute('data-panel-animating')
  expect(vi.getTimerCount()).toBe(1)
  act(() => vi.advanceTimersByTime(208))
  expect(vi.getTimerCount()).toBe(0)
})

test('a user resize becomes the new preferred width after responsive collapse and recovery', () => {
  const panel = renderPanel(true, 352)
  panel.resize(376)
  panel.measure(330)
  panel.present(false)
  panel.present(true)
  act(() => vi.advanceTimersByTime(32))
  expect(panel.controller.resize).toHaveBeenLastCalledWith('376px')
  expect(panel.contentWidth()).toBe('376px')
})

test('a group resize restores the preference after the layout observer has updated its geometry', () => {
  const panel = renderPanel(true, 352)
  panel.measure(334)
  panel.groupResize()
  expect(panel.controller.resize).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(16))
  expect(panel.controller.resize).toHaveBeenCalledExactlyOnceWith('352px')
})

test('automatic restoration does not interfere with an active separator drag', () => {
  const panel = renderPanel(true, 352)
  const separator = document.createElement('div')
  separator.dataset.separator = 'active'
  panel.element.parentElement!.append(separator)
  panel.measure(330)
  panel.groupResize()
  act(() => vi.advanceTimersByTime(16))
  expect(panel.controller.resize).not.toHaveBeenCalled()
  panel.resize(330)
  separator.remove()
  panel.groupResize()
  act(() => vi.advanceTimersByTime(16))
  expect(panel.controller.resize).not.toHaveBeenCalled()
})

function retainExitingFrame(panel: ReturnType<typeof renderPanel>) {
  const frame = panel.element.querySelector<HTMLElement>('.workspace-panel-content')!
  vi.spyOn(panel.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 238, 700))
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 352, 700))
  return frame
}

test.each(['left', 'right'] as const)(
  'button and responsive closing use the same content state and 240ms lifetime on the %s',
  (side) => {
    const panel = renderPanel(true, 352, true, side)
    const frame = retainExitingFrame(panel)
    panel.toggle(false)
    expect(frame).toHaveAttribute('data-panel-open', 'false')
    expect(panel.element.parentElement).toHaveAttribute('data-panel-animating')
    act(() => vi.advanceTimersByTime(239))
    expect(panel.element.parentElement).toHaveAttribute('data-panel-animating')
    act(() => vi.advanceTimersByTime(1))
    expect(panel.element.parentElement).not.toHaveAttribute('data-panel-animating')

    panel.toggle(true)
    act(() => vi.advanceTimersByTime(240))
    panel.present(false)
    expect(panel.controller.collapse).toHaveBeenCalledTimes(2)
    expect(frame).toHaveAttribute('data-panel-open', 'false')
    expect(frame).toHaveAttribute('inert')
    expect(frame).toHaveAttribute('data-panel-detached', side)
    expect(frame.style.getPropertyValue('--panel-detached-width')).toBe('352px')
    expect(panel.element.parentElement).not.toHaveAttribute('data-panel-animating')
    act(() => vi.advanceTimersByTime(239))
    expect(frame).toContainElement(screen.getByTestId('shared-controls'))
    expect(screen.getAllByTestId('shared-controls')).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('floating')).toContainElement(screen.getByTestId('shared-controls'))
    expect(screen.getAllByTestId('shared-controls')).toHaveLength(1)
  },
)

test('fixed layout restores before floating close completes, without animating its width', () => {
  const panel = renderPanel(true, 352, false)
  panel.present(true)
  act(() => vi.advanceTimersByTime(32))
  expect(panel.controller.resize).toHaveBeenLastCalledWith('352px')
  expect(panel.element.parentElement).not.toHaveAttribute('data-panel-animating')
  expect(screen.getByTestId('floating')).toContainElement(screen.getByTestId('shared-controls'))
  act(() => vi.advanceTimersByTime(208))
  expect(panel.element).toContainElement(screen.getByTestId('shared-controls'))
  expect(screen.getAllByTestId('shared-controls')).toHaveLength(1)
})

test('rapid breakpoint reversals cancel the handoff and preserve one content view', () => {
  const panel = renderPanel(true, 352)
  const frame = retainExitingFrame(panel)
  panel.present(false)
  panel.measure(0)
  act(() => vi.advanceTimersByTime(50))
  panel.present(true)
  expect(frame).not.toHaveAttribute('data-panel-detached')
  act(() => vi.advanceTimersByTime(240))
  expect(panel.element).toContainElement(screen.getByTestId('shared-controls'))
  expect(screen.getAllByTestId('shared-controls')).toHaveLength(1)
  expect(panel.controller.resize).toHaveBeenLastCalledWith('352px')
})

test('closing during a placement handoff cancels restoration without adding a second timer', () => {
  const panel = renderPanel(true, 352, false)
  panel.present(true)
  act(() => vi.advanceTimersByTime(50))
  panel.toggle(false)
  expect(vi.getTimerCount()).toBe(1)
  expect(panel.element.parentElement).not.toHaveAttribute('data-panel-animating')
  act(() => vi.advanceTimersByTime(190))
  expect(panel.element).toContainElement(screen.getByTestId('shared-controls'))
  expect(panel.element.querySelector('.workspace-panel-content')).toHaveAttribute(
    'data-panel-open',
    'false',
  )
  expect(vi.getTimerCount()).toBe(0)
})

test('reduced motion skips the handoff delay and layout animation', () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
  const panel = renderPanel(true, 352)
  retainExitingFrame(panel)
  panel.present(false)
  expect(screen.getByTestId('floating')).toContainElement(screen.getByTestId('shared-controls'))
  expect(vi.getTimerCount()).toBe(0)
  panel.present(true)
  expect(panel.element.parentElement).not.toHaveAttribute('data-panel-animating')
})

test('unmount cancels a pending handoff and removes the detached frame styles', () => {
  const panel = renderPanel(true, 352)
  const frame = retainExitingFrame(panel)
  panel.present(false)
  panel.unmount()
  expect(frame).not.toHaveAttribute('data-panel-detached')
  expect(vi.getTimerCount()).toBe(0)
})

test.each(['240ms', '.24s'])(
  'honors the CSS duration %s before releasing the outgoing view',
  (duration) => {
    document.documentElement.style.setProperty('--panel-duration', duration)
    const panel = renderPanel(true, 352)
    const frame = retainExitingFrame(panel)
    panel.present(false)
    act(() => vi.advanceTimersByTime(239))
    expect(frame).toContainElement(screen.getByTestId('shared-controls'))
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('floating')).toContainElement(screen.getByTestId('shared-controls'))
  },
)
