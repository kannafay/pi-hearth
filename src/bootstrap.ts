type StartupWindow = Window & { __HEARTH_STARTUP_READY__?: Promise<void> }

// Keep the native reveal independent of the React workspace and its dependency graph.
void ((window as StartupWindow).__HEARTH_STARTUP_READY__ ?? Promise.resolve()).then(
  () => import('./main'),
)
