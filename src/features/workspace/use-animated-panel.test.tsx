import { useImperativeHandle, useLayoutEffect } from 'react'
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
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderPanel(initialOpen: boolean, initialWidth = 260) {
  let onPanelResize: ReturnType<typeof useAnimatedPanel>['onResize']
  let pixels = initialOpen ? initialWidth : 0
  let open = initialOpen
  let width = initialWidth
  let docked = true
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
  }: Pick<ReturnType<typeof useAnimatedPanel>, 'panelRef' | 'elementRef'>) {
    useImperativeHandle(panelRef, () => controller)
    return <div ref={elementRef} data-testid="panel" />
  }

  function Preview({ open, width, docked }: { open: boolean; width: number; docked: boolean }) {
    const { panelRef, elementRef, onResize } = useAnimatedPanel(open, width, docked)
    useLayoutEffect(() => {
      onPanelResize = onResize
    })
    return (
      <div>
        <PanelElement panelRef={panelRef} elementRef={elementRef} />
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
    toggle: (next: boolean) => {
      open = next
      update()
    },
    present: (next: boolean) => {
      docked = next
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
  act(() => vi.advanceTimersByTime(140))
  panel.measure(200)
  expect(panel.contentWidth()).toBe('310px')

  panel.measure(310)
  act(() => vi.advanceTimersByTime(80))
  panel.resize(340)
  expect(panel.contentWidth()).toBe('340px')
})

test('reopens at its last pixel width after the group resizes while collapsed', () => {
  const panel = renderPanel(true)
  panel.resize(314)
  panel.toggle(false)
  panel.measure(0)
  act(() => vi.advanceTimersByTime(220))

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
  act(() => vi.advanceTimersByTime(220))
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
