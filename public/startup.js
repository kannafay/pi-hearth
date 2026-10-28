// This small bootstrap runs before the React module and its dependencies load.
const startupLogo = document.querySelector('.startup-logo')
const bridge = window.__TAURI_INTERNALS__
window.__HEARTH_STARTUP_READY__ = new Promise((resolve) => {
  if (!bridge) {
    resolve()
    return
  }
  let revealed = false
  const reveal = () => {
    if (revealed) return
    revealed = true
    clearTimeout(fallback)
    void bridge
      .invoke('window_startup_ready')
      .catch((reason) => {
        console.warn('Unable to reveal the startup screen:', reason)
      })
      .finally(resolve)
  }
  // Image decoding and animation frames can both stall while the window is cloaked.
  // Start the fallback before either wait so the native window appears promptly.
  const fallback = setTimeout(reveal, 120)
  Promise.resolve(startupLogo?.decode())
    .catch(() => undefined)
    .then(() => {
      requestAnimationFrame(() => requestAnimationFrame(reveal))
    })
})
