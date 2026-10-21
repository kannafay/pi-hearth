import { useImperativeHandle, useLayoutEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAnimatedPanel } from './use-animated-panel'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function renderPanel(initialOpen: boolean) {
  let onPanelResize: ReturnType<typeof useAnimatedPanel>['onResize']
  let pixels = initialOpen ? 260 : 0
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

  function Preview({ open }: { open: boolean }) {
    const { panelRef, elementRef, onResize } = useAnimatedPanel(open, 260)
    useLayoutEffect(() => {
      onPanelResize = onResize
    })
    return (
      <div>
        <PanelElement panelRef={panelRef} elementRef={elementRef} />
      </div>
    )
  }

  const view = render(<Preview open={initialOpen} />)
  const element = screen.getByTestId('panel')
  Object.defineProperty(element, 'offsetWidth', { get: () => pixels })

  return {
    element,
    toggle: (open: boolean) => view.rerender(<Preview open={open} />),
    resize: (width: number) => {
      pixels = width
      act(() => onPanelResize({ inPixels: width, asPercentage: 25 }))
    },
    contentWidth: () => element.style.getPropertyValue('--workspace-panel-width'),
  }
}

test('keeps content at its expanded width through collapse and a rapid reopening', () => {
  const panel = renderPanel(true)
  panel.resize(310)
  panel.toggle(false)
  panel.resize(120)
  expect(panel.contentWidth()).toBe('310px')

  act(() => vi.advanceTimersByTime(80))
  panel.toggle(true)
  panel.resize(55)
  act(() => vi.advanceTimersByTime(140))
  panel.resize(200)
  expect(panel.contentWidth()).toBe('310px')

  panel.resize(310)
  act(() => vi.advanceTimersByTime(80))
  panel.resize(340)
  expect(panel.contentWidth()).toBe('340px')
})

test('uses an expanded content width on first opening and resyncs when settled', () => {
  const panel = renderPanel(false)
  panel.resize(0)
  expect(panel.contentWidth()).toBe('260px')

  panel.toggle(true)
  panel.resize(80)
  expect(panel.contentWidth()).toBe('260px')
  panel.resize(280)
  act(() => vi.advanceTimersByTime(220))
  expect(panel.contentWidth()).toBe('280px')
})
