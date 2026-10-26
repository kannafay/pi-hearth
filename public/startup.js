// This small bootstrap runs before the React module and its dependencies load.
const startupLogo = document.querySelector('.startup-logo')
Promise.resolve(startupLogo?.decode())
  .catch(() => undefined)
  .then(() => {
    const bridge = window.__TAURI_INTERNALS__
    if (!bridge) return
    let revealed = false
    const reveal = () => {
      if (revealed) return
      revealed = true
      clearTimeout(fallback)
      void bridge.invoke('window_startup_ready').catch((reason) => {
        console.warn('Unable to reveal the startup screen:', reason)
      })
    }
    // Cloaked windows can throttle animation frames; keep the paint wait bounded.
    const fallback = setTimeout(reveal, 120)
    requestAnimationFrame(() => requestAnimationFrame(reveal))
  })
