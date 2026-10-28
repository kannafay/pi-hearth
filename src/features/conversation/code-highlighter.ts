import { startTransition } from 'react'
import { code } from '@streamdown/code'
import type { CodeHighlighterPlugin, HighlightOptions, HighlightResult } from 'streamdown'

type HighlightWorker = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>
type Pending = {
  key: string
  options: HighlightOptions
  callbacks: ((result: HighlightResult) => void)[]
}

const MAX_HIGHLIGHT_CHARACTERS = 200_000
const HIGHLIGHT_TIMEOUT = 5000

export function createWorkerHighlighter(createWorker: () => HighlightWorker) {
  let worker: HighlightWorker | undefined
  let disabled = false
  let sequence = 0
  let active: number | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let pendingCharacters = 0
  let cachedCharacters = 0
  const pending = new Map<number, Pending>()
  const cache = new Map<string, { result: HighlightResult; size: number }>()

  const plain = (options: HighlightOptions): HighlightResult => ({
    tokens: options.code.split('\n').map((content) => [{ content }]),
  })
  function showPlain(request: Pending) {
    if (!request.callbacks.length) return
    const result = plain(request.options)
    startTransition(() => request.callbacks.forEach((callback) => callback(result)))
  }

  function dispose() {
    clearTimeout(deadline)
    deadline = undefined
    disabled = true
    worker?.terminate()
    worker = undefined
    pending.clear()
    active = undefined
    pendingCharacters = 0
    cache.clear()
    cachedCharacters = 0
  }

  function fail() {
    const waiting = [...pending.values()]
    dispose()
    waiting.forEach(showPlain)
  }

  function dispatch() {
    if (active !== undefined || !worker) return
    const next = pending.entries().next().value
    if (!next) return
    const [id, request] = next
    active = id
    // A pathological grammar must not stall every later block in the shared worker.
    deadline = setTimeout(fail, HIGHLIGHT_TIMEOUT)
    try {
      worker.postMessage({ id, options: request.options })
    } catch {
      fail()
    }
  }

  function receive(event: MessageEvent<{ id: number; result: HighlightResult }>) {
    if (event.data.id !== active) return
    const request = pending.get(event.data.id)
    if (!request) return
    clearTimeout(deadline)
    deadline = undefined
    pending.delete(event.data.id)
    pendingCharacters -= request.options.code.length
    active = undefined
    const { result } = event.data
    const size = request.options.code.length
    if (!request.options.isIncomplete && size <= 1_000_000) {
      const old = cache.get(request.key)
      if (old) cachedCharacters -= old.size
      cache.delete(request.key)
      cache.set(request.key, { result, size })
      cachedCharacters += size
      while (cache.size > 32 || cachedCharacters > 1_000_000) {
        const [key, entry] = cache.entries().next().value!
        cache.delete(key)
        cachedCharacters -= entry.size
      }
    }
    dispatch()
    // Reconcile token spans as background work so typing and navigation win.
    startTransition(() => request.callbacks.forEach((callback) => callback(result)))
  }

  const highlighter: CodeHighlighterPlugin = {
    ...code,
    highlight(options, callback) {
      // Check before constructing a second copy of a potentially huge source as its cache key.
      if (disabled || options.code.length > MAX_HIGHLIGHT_CHARACTERS) return plain(options)
      const key = JSON.stringify([options.language, options.themes, options.code])
      const cached = cache.get(key)
      if (cached) {
        cache.delete(key)
        cache.set(key, cached)
        return cached.result
      }
      for (const request of pending.values()) {
        if (request.key !== key) continue
        if (callback) request.callbacks.push(callback)
        return null
      }
      try {
        if (!worker) {
          worker = createWorker()
          worker.addEventListener('message', receive)
          worker.addEventListener('error', (event) => {
            event.preventDefault()
            fail()
          })
        }
        const id = ++sequence
        pending.set(id, { key, options, callbacks: callback ? [callback] : [] })
        pendingCharacters += options.code.length
        // A fast stream must not build an unbounded worker-message backlog.
        // Evicted requests keep their existing plain-code fallback.
        while ((pending.size > 64 || pendingCharacters > 4_000_000) && pending.size > 1) {
          const stale = [...pending].find(([key]) => key !== active)!
          pending.delete(stale[0])
          pendingCharacters -= stale[1].options.code.length
          showPlain(stale[1])
        }
        dispatch()
      } catch {
        // The existing plain-code view stays usable if workers are unavailable.
        fail()
        return plain(options)
      }
      return null
    },
  }
  return { highlighter, dispose }
}

const client = createWorkerHighlighter(
  () => new Worker(new URL('./code-highlighter.worker.ts', import.meta.url), { type: 'module' }),
)
export const codeHighlighter = client.highlighter
import.meta.hot?.dispose(client.dispose)
