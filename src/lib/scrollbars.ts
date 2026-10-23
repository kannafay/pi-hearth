import { ClickScrollPlugin, OverlayScrollbars } from 'overlayscrollbars'

OverlayScrollbars.plugin(ClickScrollPlugin)

const scrollable = [
  '[data-scroll-area]',
  ...['auto', 'scroll'].flatMap((overflow) =>
    ['', '-x', '-y'].map((axis) => `[class~="overflow${axis}-${overflow}"]`),
  ),
].join(',')

// Keep the existing viewport so native refs, keyboard navigation and streaming
// auto-follow continue to scroll the same element, including portalled menus.
export function installScrollbars(root: HTMLElement) {
  const instances = new Map<HTMLElement, OverlayScrollbars>()
  const contentOwners = new Map<Element, OverlayScrollbars>()
  let frame: number | null = null
  let disposed = false

  // A fixed native viewport doesn't resize when its children expand or collapse.
  // Observe its content boxes too, so handle proportions follow each layout frame.
  const contentObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          if (disposed) return
          const changed = new Set<OverlayScrollbars>()
          for (const entry of entries) {
            const instance = contentOwners.get(entry.target)
            if (instance && !instance.state().destroyed) changed.add(instance)
          }
          for (const instance of changed) instance.update(true)
        })

  function synchronize() {
    frame = null
    if (disposed) return
    for (const [element, instance] of instances) {
      if (!root.contains(element)) {
        instance.destroy()
        instances.delete(element)
      } else if (!instance.elements().scrollbarVertical.scrollbar.isConnected) {
        // React may replace a plain-text container's entire contents.
        instance.destroy()
        instances.delete(element)
      }
    }
    for (const element of root.querySelectorAll<HTMLElement>(scrollable)) {
      if (instances.has(element) || element instanceof HTMLTextAreaElement) continue
      const style = getComputedStyle(element)
      const slot = element.hasAttribute('data-scrollbars-external')
        ? element.parentElement?.querySelector<HTMLElement>(':scope > [data-scrollbars-slot]')
        : null
      const instance = OverlayScrollbars(
        { target: element, elements: { viewport: element }, scrollbars: { slot: slot ?? element } },
        {
          overflow: {
            x: /auto|scroll/.test(style.overflowX) ? 'scroll' : 'hidden',
            y: /auto|scroll/.test(style.overflowY) ? 'scroll' : 'hidden',
          },
          update: {
            elementEvents: [
              ['img', 'load'],
              ['textarea', 'input'],
            ],
          },
          scrollbars: {
            theme: 'os-theme-hearth',
            autoHide: 'leave',
            autoHideDelay: 400,
            clickScroll: true,
          },
        },
      )
      instances.set(element, instance)
    }

    if (contentObserver) {
      const nextOwners = new Map<Element, OverlayScrollbars>()
      for (const [element, instance] of instances) {
        for (const child of element.children) {
          if (child.matches('.os-scrollbar, .os-size-observer, .os-trinsic-observer')) continue
          nextOwners.set(child, instance)
        }
      }
      for (const [child, instance] of contentOwners) {
        if (nextOwners.get(child) === instance) continue
        contentObserver.unobserve(child)
        contentOwners.delete(child)
      }
      for (const [child, instance] of nextOwners) {
        if (contentOwners.has(child)) continue
        contentOwners.set(child, instance)
        contentObserver.observe(child)
      }
    }
  }

  const observer = new MutationObserver((records) => {
    if (
      frame === null &&
      records.some(
        (record) => record.target instanceof Element && !record.target.closest('.os-scrollbar'),
      )
    ) {
      frame = requestAnimationFrame(synchronize)
    }
  })
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  })
  synchronize()

  return () => {
    disposed = true
    observer.disconnect()
    contentObserver?.disconnect()
    contentOwners.clear()
    if (frame !== null) cancelAnimationFrame(frame)
    for (const instance of instances.values()) instance.destroy()
    instances.clear()
  }
}
