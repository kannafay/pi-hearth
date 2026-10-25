import { afterEach, expect, test, vi } from 'vitest'
import { finishThemeColorTransitions } from './theme-transitions'

afterEach(() => vi.unstubAllGlobals())

test('finishing a parent color also resolves transitions started by its inherited color', () => {
  let childStarted = false
  const child = { transitionProperty: 'color', finish: vi.fn(), cancel: vi.fn() }
  const parent = {
    transitionProperty: 'color',
    finish: vi.fn(() => {
      childStarted = true
    }),
    cancel: vi.fn(),
  }
  vi.stubGlobal('document', { getAnimations: () => (childStarted ? [parent, child] : [parent]) })
  finishThemeColorTransitions()
  expect(parent.finish).toHaveBeenCalledOnce()
  expect(child.finish).toHaveBeenCalledOnce()
})

test('palette changes finish while panel, hover opacity, and keyframe animations keep running', () => {
  const transitions = [
    'color',
    'background-color',
    'border-top-color',
    'box-shadow',
    'fill',
    'stroke',
    'transform',
    'translate',
    'height',
    'opacity',
    '--sidebar-title-tail-opacity',
  ].map((transitionProperty) => ({ transitionProperty, finish: vi.fn(), cancel: vi.fn() }))
  const keyframe = { finish: vi.fn(), cancel: vi.fn() }
  vi.stubGlobal('document', { getAnimations: () => [...transitions, keyframe] })
  finishThemeColorTransitions()
  for (const transition of transitions.slice(0, 6)) expect(transition.finish).toHaveBeenCalledOnce()
  for (const transition of [...transitions.slice(6), keyframe]) {
    expect(transition.finish).not.toHaveBeenCalled()
    expect(transition.cancel).not.toHaveBeenCalled()
  }
})

test('an unfinishable color transition is cancelled without cancelling another animation', () => {
  const color = {
    transitionProperty: 'color',
    finish: vi.fn(() => {
      throw new Error('zero playback rate')
    }),
    cancel: vi.fn(),
  }
  const motion = { transitionProperty: 'transform', finish: vi.fn(), cancel: vi.fn() }
  vi.stubGlobal('document', { getAnimations: () => [color, motion] })
  finishThemeColorTransitions()
  expect(color.cancel).toHaveBeenCalledOnce()
  expect(motion.cancel).not.toHaveBeenCalled()
})
