import { useContext } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { StreamdownContext, type HighlightResult } from 'streamdown'
import { CodeBody } from './code-body'
import { codeHighlighter } from './code-highlighter'

vi.mock('./code-highlighter', () => ({ codeHighlighter: { highlight: vi.fn() } }))

function Body({
  code,
  active = false,
  open = true,
  numbers = true,
}: {
  code: string
  active?: boolean
  open?: boolean
  numbers?: boolean
}) {
  const context = useContext(StreamdownContext)
  return (
    <StreamdownContext value={{ ...context, isAnimating: active }}>
      <CodeBody
        code={code}
        language="text"
        isIncomplete={false}
        open={open}
        startLine={13}
        lineNumbers={numbers}
      />
    </StreamdownContext>
  )
}

beforeEach(() => {
  vi.mocked(codeHighlighter.highlight)
    .mockReset()
    .mockImplementation(({ code }) => ({
      tokens: code.split('\n').map((content) => [{ content, color: '#123456' }]),
    }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.getSelection()?.removeAllRanges()
})

test('long code keeps all source lines while limiting highlighted spans to the visible chunks', () => {
  const source = Array.from({ length: 1000 }, (_, index) => 'line ' + index).join('\n')
  const view = render(<Body code={source} />)
  const viewport = view.container.querySelector<HTMLElement>('[data-streamdown="code-block-body"]')!
  Object.defineProperties(viewport, {
    clientHeight: { value: 400 },
    scrollHeight: { value: 20800 },
  })
  fireEvent.scroll(viewport)
  const tokens = () => viewport.querySelectorAll('span[style*="--sdm-c"]')
  expect(tokens().length).toBeGreaterThan(0)
  expect(tokens().length).toBeLessThan(50)
  expect(viewport.textContent).toContain('line 999')
  expect(viewport.querySelector('[data-line-labels]')).toHaveAttribute(
    'data-line-labels',
    Array.from({ length: 16 }, (_, index) => String(13 + index)).join('\n'),
  )
  viewport.scrollTop = 20400
  fireEvent.scroll(viewport)
  expect(screen.getByText('line 999')).toHaveStyle({ '--sdm-c': '#123456' })
  expect(tokens().length).toBeLessThan(50)
  expect(viewport.textContent).toContain('line 0')
  view.rerender(<Body code={source} numbers={false} />)
  expect(viewport.querySelector('[data-line-labels]')).toBeNull()
})

test('highlight metadata retains both theme colors and renders source as text', () => {
  const text = '<img src=x onerror=alert(1)>'
  vi.mocked(codeHighlighter.highlight).mockReturnValue({
    tokens: [
      [
        {
          content: text,
          color: '#111111',
          bgColor: '#eeeeee',
          htmlStyle: { '--shiki-dark': '#fafafa', '--shiki-dark-bg': '#333333' },
          htmlAttrs: { 'data-token': 'html' },
        },
      ],
    ],
    fg: '#111111',
    bg: '#ffffff',
    rootStyle: '--shiki-dark-bg: #222222;',
  })
  const view = render(<Body code={text} />)
  const token = screen.getByText(text)
  expect(token).toHaveStyle({
    '--sdm-c': '#111111',
    '--sdm-tbg': '#eeeeee',
    '--shiki-dark': '#fafafa',
    '--shiki-dark-bg': '#333333',
  })
  expect(token).toHaveAttribute('data-token', 'html')
  expect(view.container.querySelector('pre')).toHaveStyle({
    '--sdm-fg': '#111111',
    '--sdm-bg': '#ffffff',
    '--shiki-dark-bg': '#222222',
  })
  expect(view.container.querySelector('img')).toBeNull()
})

test('source newlines survive highlighted and plain chunk boundaries, including empty chunks', () => {
  const source = Array.from({ length: 112 }, (_, index) =>
    (index >= 16 && index < 32) || index % 15 === 0 ? '' : '中文 😀\tline ' + index,
  ).join('\n')
  const view = render(<Body code={source} />)
  const viewport = view.container.querySelector<HTMLElement>('[data-streamdown="code-block-body"]')!
  expect(viewport.querySelector('code')!.textContent).toBe(source)
  viewport.scrollTop = 1500
  fireEvent.scroll(viewport)
  expect(viewport.querySelector('code')!.textContent).toBe(source)
})

test('selecting code defers token replacement until the native text selection is cleared', () => {
  let complete!: (result: HighlightResult) => void
  vi.mocked(codeHighlighter.highlight).mockImplementation((_options, callback) => {
    complete = callback!
    return null
  })
  const view = render(<Body code="select this code" />)
  const viewport = view.container.querySelector<HTMLElement>('[data-streamdown="code-block-body"]')!
  fireEvent.pointerDown(viewport)
  const range = document.createRange()
  range.selectNodeContents(viewport.querySelector('code')!)
  document.getSelection()!.addRange(range)
  act(() => complete({ tokens: [[{ content: 'select this code', color: '#123456' }]] }))
  expect(viewport.querySelector('span[style*="--sdm-c"]')).toBeNull()
  fireEvent.pointerUp(document)
  expect(document.getSelection()!.toString()).toBe('select this code')
  expect(viewport.querySelector('span[style*="--sdm-c"]')).toBeNull()
  act(() => {
    document.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
  })
  expect(viewport.querySelector('span[style*="--sdm-c"]')).not.toBeNull()
})

test('closing a disclosure ignores a late highlight result during its exit animation', () => {
  let complete!: (result: HighlightResult) => void
  vi.mocked(codeHighlighter.highlight).mockImplementation((_options, callback) => {
    complete = callback!
    return null
  })
  const view = render(<Body code="late code" />)
  view.rerender(<Body code="late code" open={false} />)
  act(() => complete({ tokens: [[{ content: 'late code', color: '#123456' }]] }))
  expect(view.container.querySelector('span[style*="--sdm-c"]')).toBeNull()
})

test('appending streamed characters preserves existing colors while new text is immediately visible', () => {
  const callbacks: ((result: HighlightResult) => void)[] = []
  vi.mocked(codeHighlighter.highlight).mockImplementation((_options, callback) => {
    callbacks.push(callback!)
    return null
  })
  const initial = 'const ready = 1;\nconst message = "hello'
  const view = render(<Body code={initial} active />)
  const result = (code: string): HighlightResult => ({
    tokens: code.split('\n').map((content) => [{ content, color: '#123456' }]),
  })
  act(() => callbacks[0](result(initial)))
  const stableLine = screen.getByText('const ready = 1;')
  const growingLine = screen.getByText('const message = "hello')
  const next = initial + ' world";\nfinish()'
  view.rerender(<Body code={next} active />)
  expect(view.container.querySelector('code')!.textContent).toBe(next)
  expect(screen.getByText('const ready = 1;')).toBe(stableLine)
  expect(stableLine).toHaveStyle({ '--sdm-c': '#123456' })
  expect(screen.getByText('const message = "hello')).toBe(growingLine)
  expect(growingLine).toHaveStyle({ '--sdm-c': '#123456' })
  act(() => callbacks[1](result(next)))
  expect(view.container.querySelector('code')!.textContent).toBe(next)
  expect(screen.getByText('const ready = 1;')).toBe(stableLine)
  expect(screen.getByText('finish()')).toHaveStyle({ '--sdm-c': '#123456' })
})

test('changed source never displays obsolete tokens or applies a late result for an older revision', () => {
  const callbacks: ((result: HighlightResult) => void)[] = []
  vi.mocked(codeHighlighter.highlight).mockImplementation((_options, callback) => {
    callbacks.push(callback!)
    return null
  })
  const view = render(<Body code="old source" />)
  act(() => callbacks[0]({ tokens: [[{ content: 'old source', color: '#123456' }]] }))
  view.rerender(<Body code="changed source" />)
  expect(view.container.querySelector('code')!.textContent).toBe('changed source')
  expect(screen.queryByText('old source')).not.toBeInTheDocument()
  view.rerender(<Body code="current source" />)
  act(() => callbacks[1]({ tokens: [[{ content: 'changed source', color: '#123456' }]] }))
  expect(view.container.querySelector('code')!.textContent).toBe('current source')
  expect(view.container.querySelector('span[style*="--sdm-c"]')).toBeNull()
  act(() => callbacks[2]({ tokens: [[{ content: 'current source', color: '#123456' }]] }))
  expect(screen.getByText('current source')).toHaveStyle({ '--sdm-c': '#123456' })
})

test('streaming follows the end, pauses for a reader, and resumes when they return to the end', () => {
  vi.useFakeTimers()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
    window.setTimeout(() => callback(0), 16),
  )
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => clearTimeout(frame))
  const view = render(<Body code="first" active />)
  const viewport = view.container.querySelector<HTMLElement>('[data-streamdown="code-block-body"]')!
  Object.defineProperties(viewport, { clientHeight: { value: 400 }, scrollHeight: { value: 2000 } })
  act(() => vi.advanceTimersByTime(20))
  expect(viewport.scrollTop).toBe(2000)
  viewport.scrollTop = 0
  fireEvent.scroll(viewport)
  view.rerender(<Body code={'first\nsecond'} active />)
  act(() => vi.advanceTimersByTime(20))
  expect(viewport.scrollTop).toBe(0)
  viewport.scrollTop = 1600
  fireEvent.scroll(viewport)
  view.rerender(<Body code={'first\nsecond\nthird'} active />)
  act(() => vi.advanceTimersByTime(20))
  expect(viewport.scrollTop).toBe(2000)
})
