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
  const waitingForMotion = new Set<Element>()
  let frame: number | null = null
  let disposed = false

  function schedule() {
    if (frame === null && !disposed) frame = requestAnimationFrame(synchronize)
  }

  function disclosureIsMoving(element: HTMLElement) {
    let panel = element.closest('[data-slot="collapsible-content"]')
    while (panel) {
      if (typeof panel.getAnimations !== 'function') return false
      const animations = panel
        .getAnimations()
        .filter((animation) => animation.playState === 'running' || animation.pending)
      if (animations.length) {
        if (!waitingForMotion.has(panel)) {
          const movingPanel = panel
          waitingForMotion.add(movingPanel)
          void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
            waitingForMotion.delete(movingPanel)
            schedule()
          })
        }
        return true
      }
      if (panel.hasAttribute('data-starting-style')) {
        schedule()
        return true
      }
      panel = panel.parentElement?.closest('[data-slot="collapsible-content"]') ?? null
    }
    return false
  }

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
    // Read styles together before the scrollbar constructors change layout.
    const candidates = [...root.querySelectorAll<HTMLElement>(scrollable)]
      .filter(
        (element) =>
          !instances.has(element) &&
          !(element instanceof HTMLTextAreaElement) &&
          !disclosureIsMoving(element),
      )
      .map((element) => {
        const { overflowX, overflowY } = getComputedStyle(element)
        const slot = element.hasAttribute('data-scrollbars-external')
          ? element.parentElement?.querySelector<HTMLElement>(':scope > [data-scrollbars-slot]')
          : null
        return { element, overflowX, overflowY, slot }
      })
    for (const { element, overflowX, overflowY, slot } of candidates) {
      const instance = OverlayScrollbars(
        { target: element, elements: { viewport: element }, scrollbars: { slot: slot ?? element } },
        {
          overflow: {
            x: /auto|scroll/.test(overflowX) ? 'scroll' : 'hidden',
            y: /auto|scroll/.test(overflowY) ? 'scroll' : 'hidden',
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

  function containsScrollArea(node: Node) {
    return (
      node instanceof Element &&
      (node.matches(scrollable) ||
        (node.childElementCount > 0 && node.querySelector(scrollable) !== null))
    )
  }

  const observer = new MutationObserver((records) => {
    if (frame !== null || disposed) return
    const changed = records.some((record) => {
      const target = record.target
      if (!(target instanceof HTMLElement) || target.closest('.os-scrollbar')) return false
      // Code tokens cannot introduce scroll panes; their viewport already observes size changes.
      if (target.closest('[data-streamdown="code-block-body"] pre')) return false
      if (record.type === 'attributes') return !instances.has(target) && target.matches(scrollable)
      // Only structural changes to scroll containers need discovery. Highlighted
      // tokens, clocks and unrelated button classes do not change that inventory.
      return (
        instances.has(target) ||
        [...record.addedNodes, ...record.removedNodes].some(containsScrollArea)
      )
    })
    if (changed) {
      schedule()
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
    waitingForMotion.clear()
    if (frame !== null) cancelAnimationFrame(frame)
    for (const instance of instances.values()) instance.destroy()
    instances.clear()
  }
}
