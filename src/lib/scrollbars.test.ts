import { fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { OverlayScrollbars } from 'overlayscrollbars'
import { installScrollbars } from './scrollbars'

let root: HTMLDivElement
let stop: () => void

beforeEach(() => {
  // JSDOM does not implement pseudo-element computed styles used by the package.
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => computed(element))
  root = document.createElement('div')
  document.body.append(root)
})
afterEach(() => {
  stop?.()
  root.remove()
})

function pane(tag = 'div') {
  const element = document.createElement(tag)
  element.className = 'overflow-y-auto'
  element.style.overflowY = 'auto'
  element.textContent = '原有内容'
  return element
}

test('native scrolling refs, listeners and content survive initialization and cleanup', () => {
  const element = pane()
  const scrolled = vi.fn()
  element.addEventListener('scroll', scrolled)
  root.append(element)
  element.scrollTop = 35
  stop = installScrollbars(root)
  expect(OverlayScrollbars(element)?.elements().viewport).toBe(element)
  expect(element.scrollTop).toBe(35)
  element.scrollTop = 70
  fireEvent.scroll(element)
  expect(scrolled).toHaveBeenCalledOnce()
  stop()
  expect(element.textContent).toBe('原有内容')
  expect(element.querySelector('.os-scrollbar')).toBeNull()
  expect(element.hasAttribute('data-overlayscrollbars')).toBe(false)
})

test('new popup and execution containers are initialized and removed instances are destroyed', async () => {
  stop = installScrollbars(root)
  const element = pane()
  root.append(element)
  await waitFor(() => expect(OverlayScrollbars(element)).toBeDefined())
  const instance = OverlayScrollbars(element)!
  element.remove()
  await waitFor(() => expect(instance.state().destroyed).toBe(true))
})

test('replacing plain tool output restores scrollbars without losing its new text', async () => {
  const element = pane('pre')
  root.append(element)
  stop = installScrollbars(root)
  element.textContent = '流式更新后的工具输出'
  await waitFor(() => expect(element.querySelector('.os-scrollbar')).not.toBeNull())
  expect(element.textContent).toBe('流式更新后的工具输出')
  expect(OverlayScrollbars(element)?.elements().viewport).toBe(element)
})

test('resizable input and chat viewports keep scrollbar elements outside their scroll range', async () => {
  const element = pane()
  element.setAttribute('data-scrollbars-external', '')
  const slot = document.createElement('div')
  slot.setAttribute('data-scrollbars-slot', '')
  root.append(element, slot)
  stop = installScrollbars(root)
  const instance = OverlayScrollbars(element)!
  expect(instance.elements().viewport).toBe(element)
  expect(element.querySelector('.os-scrollbar')).toBeNull()
  expect(slot.querySelectorAll('.os-scrollbar')).toHaveLength(2)
  element.textContent = ''
  await waitFor(() => expect(OverlayScrollbars(element)).toBe(instance))
  expect(slot.querySelectorAll('.os-scrollbar')).toHaveLength(2)
})
