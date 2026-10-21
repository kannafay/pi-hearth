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
  let frame: number | null = null
  let disposed = false

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
    if (frame !== null) cancelAnimationFrame(frame)
    for (const instance of instances.values()) instance.destroy()
    instances.clear()
  }
}
