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
  vi.unstubAllGlobals()
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

test('unrelated styling changes do not rescan the document for scroll containers', async () => {
  const element = pane()
  const label = document.createElement('span')
  element.append(label)
  root.append(element)
  stop = installScrollbars(root)
  const nextFrames = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await nextFrames()
  const scan = vi.spyOn(root, 'querySelectorAll')
  label.className = 'text-muted-foreground'
  await nextFrames()
  expect(scan).not.toHaveBeenCalled()
})

test('a container that becomes scrollable is initialized without scanning unrelated content', async () => {
  const section = document.createElement('section')
  const element = document.createElement('div')
  section.append(element)
  root.append(section)
  stop = installScrollbars(root)
  element.style.overflowY = 'auto'
  element.className = 'overflow-y-auto'
  await waitFor(() => expect(OverlayScrollbars(element)).toBeDefined())
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

function contentResizeObserver() {
  let callback!: ResizeObserverCallback
  const observe = vi.fn()
  const unobserve = vi.fn()
  const disconnect = vi.fn()
  const observer = { observe, unobserve, disconnect }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = observe
      unobserve = unobserve
      disconnect = disconnect
      constructor(onResize: ResizeObserverCallback) {
        callback = onResize
      }
    },
  )
  return {
    observe,
    unobserve,
    disconnect,
    resize: (...targets: Element[]) =>
      callback(targets.map((target) => ({ target })) as ResizeObserverEntry[], observer),
  }
}

test('content resizing updates its owning scrollbar on every frame and batches sibling boxes', () => {
  const observer = contentResizeObserver()
  const element = pane()
  const first = document.createElement('section')
  const second = document.createElement('section')
  element.replaceChildren(first, second)
  const other = pane()
  other.append(document.createElement('section'))
  root.append(element, other)
  stop = installScrollbars(root)
  const instance = OverlayScrollbars(element)!
  const update = vi.spyOn(instance, 'update')
  const otherUpdate = vi.spyOn(OverlayScrollbars(other)!, 'update')
  expect(observer.observe).toHaveBeenCalledWith(first)
  expect(observer.observe).toHaveBeenCalledWith(second)
  expect(observer.observe).not.toHaveBeenCalledWith(instance.elements().scrollbarVertical.scrollbar)
  observer.resize(first, second)
  expect(update).toHaveBeenCalledOnce()
  expect(update).toHaveBeenCalledWith(true)
  expect(otherUpdate).not.toHaveBeenCalled()
  observer.resize(first)
  expect(update).toHaveBeenCalledTimes(2)
  expect(instance.elements().viewport).toBe(element)
})

test('replaced and removed content boxes stop being observed and cleanup cancels pending notifications', async () => {
  const observer = contentResizeObserver()
  const element = pane()
  const original = document.createElement('section')
  original.textContent = '原内容'
  element.replaceChildren(original)
  root.append(element)
  stop = installScrollbars(root)
  const instance = OverlayScrollbars(element)!
  const update = vi.spyOn(instance, 'update')
  const replacement = document.createElement('section')
  replacement.textContent = '新内容'
  original.replaceWith(replacement)
  await waitFor(() => expect(observer.observe).toHaveBeenCalledWith(replacement))
  expect(observer.unobserve).toHaveBeenCalledWith(original)
  update.mockClear()
  observer.resize(original)
  expect(update).not.toHaveBeenCalled()
  observer.resize(replacement)
  expect(update).toHaveBeenCalledOnce()
  element.remove()
  await waitFor(() => expect(instance.state().destroyed).toBe(true))
  expect(observer.unobserve).toHaveBeenCalledWith(replacement)
  update.mockClear()
  observer.resize(replacement)
  expect(update).not.toHaveBeenCalled()
  stop()
  expect(observer.disconnect).toHaveBeenCalledOnce()
  observer.resize(replacement)
  expect(update).not.toHaveBeenCalled()
})
