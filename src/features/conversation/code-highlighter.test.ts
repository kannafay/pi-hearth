import { expect, test, vi } from 'vitest'
import { code } from '@streamdown/code'
import type { HighlightOptions, HighlightResult } from 'streamdown'
import { createWorkerHighlighter } from './code-highlighter'

const options: HighlightOptions = {
  code: 'const answer = 42',
  language: 'typescript',
  themes: ['github-light', 'github-dark'],
}
const result: HighlightResult = { tokens: [[{ content: options.code, color: '#111' }]] }

function setup() {
  const worker = Object.assign(new EventTarget(), { postMessage: vi.fn(), terminate: vi.fn() })
  const create = vi.fn(() => worker as unknown as Worker)
  const client = createWorkerHighlighter(create)
  const reply = (id: number, value = result) =>
    worker.dispatchEvent(new MessageEvent('message', { data: { id, result: value } }))
  return { ...client, worker, create, reply }
}

test('highlighting starts a worker lazily and never runs tokenization on the UI thread', () => {
  const { highlighter, create, worker, reply } = setup()
  const local = vi.spyOn(code, 'highlight')
  const ready = vi.fn()
  expect(create).not.toHaveBeenCalled()
  expect(highlighter.highlight(options, ready)).toBeNull()
  expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, options })
  expect(local).not.toHaveBeenCalled()
  expect(ready).not.toHaveBeenCalled()
  reply(1)
  expect(ready).toHaveBeenCalledWith(result)
})

test('identical pending requests share work and completed results are reused', () => {
  const { highlighter, worker, reply } = setup()
  const first = vi.fn()
  const second = vi.fn()
  highlighter.highlight(options, first)
  highlighter.highlight(options, second)
  expect(worker.postMessage).toHaveBeenCalledOnce()
  reply(1)
  expect(first).toHaveBeenCalledWith(result)
  expect(second).toHaveBeenCalledWith(result)
  expect(highlighter.highlight(options)).toBe(result)
  expect(worker.postMessage).toHaveBeenCalledOnce()
})

test('distinct blocks share a serial worker without mixing their results', () => {
  const { highlighter, worker, reply } = setup()
  const first = vi.fn()
  const second = vi.fn()
  highlighter.highlight(options, first)
  highlighter.highlight({ ...options, code: 'other code' }, second)
  expect(worker.postMessage).toHaveBeenCalledOnce()
  const other = { tokens: [[{ content: 'other code' }]] }
  reply(2, other)
  expect(first).not.toHaveBeenCalled()
  expect(second).not.toHaveBeenCalled()
  reply(1)
  expect(first).toHaveBeenCalledWith(result)
  expect(worker.postMessage).toHaveBeenCalledTimes(2)
  reply(2, other)
  expect(second).toHaveBeenCalledWith(other)
})

test('streaming revisions are not retained in the completed cache', () => {
  const { highlighter, worker, reply } = setup()
  const streaming = { ...options, isIncomplete: true }
  highlighter.highlight(streaming)
  reply(1)
  highlighter.highlight(streaming)
  expect(worker.postMessage).toHaveBeenCalledTimes(2)
  reply(2)
})

test('oversized blocks stay readable without starting expensive tokenization', () => {
  const { highlighter, create } = setup()
  const huge = { ...options, code: 'x'.repeat(200_001) + '\nlast line' }
  expect(highlighter.highlight(huge)).toEqual({
    tokens: [[{ content: 'x'.repeat(200_001) }], [{ content: 'last line' }]],
  })
  expect(create).not.toHaveBeenCalled()
})

test('a stalled worker releases every waiting block and ignores its late response', () => {
  vi.useFakeTimers()
  const { highlighter, worker, reply, dispose } = setup()
  try {
    const first = vi.fn()
    const second = vi.fn()
    highlighter.highlight(options, first)
    highlighter.highlight({ ...options, code: 'queued source' }, second)
    vi.advanceTimersByTime(5000)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(first).toHaveBeenCalledWith({ tokens: [[{ content: options.code }]] })
    expect(second).toHaveBeenCalledWith({ tokens: [[{ content: 'queued source' }]] })
    reply(1)
    expect(first).toHaveBeenCalledOnce()
    expect(highlighter.highlight({ ...options, code: 'new source' })).toEqual({
      tokens: [[{ content: 'new source' }]],
    })
  } finally {
    dispose()
    vi.useRealTimers()
  }
})

test('completed work and disposal clear the worker deadline', () => {
  vi.useFakeTimers()
  const { highlighter, worker, reply, dispose } = setup()
  try {
    highlighter.highlight(options)
    vi.advanceTimersByTime(4000)
    reply(1)
    vi.advanceTimersByTime(5000)
    expect(worker.terminate).not.toHaveBeenCalled()
    highlighter.highlight({ ...options, code: 'another source' })
    dispose()
    vi.advanceTimersByTime(5000)
    expect(worker.terminate).toHaveBeenCalledOnce()
  } finally {
    dispose()
    vi.useRealTimers()
  }
})

test('fast streaming bounds queued work while keeping the latest revision', () => {
  const { highlighter, worker, reply } = setup()
  highlighter.highlight(options)
  for (let index = 0; index < 100; index++)
    highlighter.highlight({ ...options, code: 'x'.repeat(100_000) + index, isIncomplete: true })
  expect(worker.postMessage).toHaveBeenCalledOnce()
  reply(1)
  const next = worker.postMessage.mock.calls[1][0] as { id: number; options: HighlightOptions }
  expect(next.id).toBeGreaterThan(50)
  while (worker.postMessage.mock.calls.length < 50) {
    const request = worker.postMessage.mock.lastCall![0] as { id: number }
    const count = worker.postMessage.mock.calls.length
    reply(request.id)
    if (worker.postMessage.mock.calls.length === count) break
  }
  expect((worker.postMessage.mock.lastCall![0] as { options: HighlightOptions }).options.code).toBe(
    'x'.repeat(100_000) + 99,
  )
})

test('the completed cache evicts old blocks and worker failures leave plain code usable', () => {
  const { highlighter, worker, reply, dispose } = setup()
  for (let index = 0; index < 33; index++) {
    highlighter.highlight({ ...options, code: String(index) })
    reply(index + 1)
  }
  highlighter.highlight({ ...options, code: '0' })
  expect(worker.postMessage).toHaveBeenCalledTimes(34)
  worker.dispatchEvent(new Event('error', { cancelable: true }))
  expect(worker.terminate).toHaveBeenCalledOnce()
  expect(highlighter.highlight(options)?.tokens[0][0].content).toBe(options.code)
  expect(worker.postMessage).toHaveBeenCalledTimes(34)
  dispose()
})

test('a failed worker still updates the current source instead of freezing old highlighted text', () => {
  const { highlighter, worker, reply } = setup()
  highlighter.highlight(options)
  reply(1)
  const ready = vi.fn()
  highlighter.highlight({ ...options, code: 'new source' }, ready)
  worker.dispatchEvent(new Event('error', { cancelable: true }))
  expect(ready).toHaveBeenCalledWith({ tokens: [[{ content: 'new source' }]] })
  expect(highlighter.highlight({ ...options, code: 'latest source' })?.tokens[0][0].content).toBe(
    'latest source',
  )
})
