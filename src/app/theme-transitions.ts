const paletteProperty = /(?:^|-)color$|^(?:box-shadow|text-shadow|fill|stroke)$/

// Finish palette changes without cancelling panel, focus, or disclosure motion.
export function finishThemeColorTransitions() {
  const finished = new Set<Animation>()
  // Finishing an inherited color can start a child's own color transition.
  for (;;) {
    const pending = (document.getAnimations?.() ?? []).filter(
      (animation) =>
        !finished.has(animation) &&
        'transitionProperty' in animation &&
        typeof animation.transitionProperty === 'string' &&
        paletteProperty.test(animation.transitionProperty),
    )
    if (!pending.length) break
    for (const animation of pending) {
      finished.add(animation)
      try {
        animation.finish()
      } catch {
        animation.cancel()
      }
    }
  }
}
