import {
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  CodeBlockContainer,
  StreamdownContext,
  type HighlightResult,
  type HighlightToken,
} from 'streamdown'
import { codeHighlighter } from './code-highlighter'

const chunkSize = 16
type Chunk = { start: number; text: string; count: number }
type Highlighted = { chunks: Chunk[]; result: HighlightResult }

function tokenStyle(token: HighlightToken): CSSProperties {
  const style: Record<string, string> = { ...token.htmlStyle }
  if (token.color) style['--sdm-c'] = token.color
  if (token.bgColor) style['--sdm-tbg'] = token.bgColor
  if (style.color) {
    style['--sdm-c'] = style.color
    delete style.color
  }
  if (style['background-color']) {
    style['--sdm-tbg'] = style['background-color']
    delete style['background-color']
  }
  return style
}

function rootStyle(result?: HighlightResult): CSSProperties {
  const style: Record<string, string> = {}
  if (result?.bg) style['--sdm-bg'] = result.bg
  if (result?.fg) style['--sdm-fg'] = result.fg
  if (result?.rootStyle)
    for (const declaration of result.rootStyle.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon > 0) style[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim()
    }
  return style
}

const CodeChunk = memo(function CodeChunk({
  chunk,
  result,
  startLine,
  lineNumbers,
}: {
  chunk: Chunk
  result?: HighlightResult
  startLine: number
  lineNumbers: boolean
}) {
  return (
    <span
      className="conversation-code-chunk"
      style={{ '--code-chunk-lines': chunk.count } as CSSProperties}
      data-line-labels={
        lineNumbers
          ? Array.from({ length: chunk.count }, (_, index) => startLine + chunk.start + index).join(
              '\n',
            )
          : undefined
      }
    >
      {result
        ? result.tokens.slice(chunk.start, chunk.start + chunk.count).map((tokens, index) => (
            <Fragment key={index}>
              {tokens.map((token, index) => (
                <span
                  key={index}
                  {...token.htmlAttrs}
                  className={
                    'text-[var(--sdm-c,inherit)] dark:text-[var(--shiki-dark,var(--sdm-c,inherit))] ' +
                    (token.bgColor || token.htmlStyle?.['background-color']
                      ? 'bg-[var(--sdm-tbg)] dark:bg-[var(--shiki-dark-bg,var(--sdm-tbg))]'
                      : '')
                  }
                  style={tokenStyle(token)}
                >
                  {token.content}
                </span>
              ))}
              {chunk.start + index < result.tokens.length - 1 ? '\n' : ''}
            </Fragment>
          ))
        : chunk.text}
    </span>
  )
})

// Keep every source line selectable and searchable; only nearby chunks need token spans.
export function CodeBody({
  code,
  language,
  isIncomplete,
  startLine,
  lineNumbers,
  open,
}: {
  code: string
  language: string
  isIncomplete: boolean
  startLine: number
  lineNumbers: boolean
  open: boolean
}) {
  const { shikiTheme, codeBlockMaxHeight, isAnimating } = useContext(StreamdownContext)
  const source = useMemo(() => code.replace(/\n+$/, ''), [code])
  const chunks = useMemo(() => {
    const lines = source.split('\n')
    const result: Chunk[] = []
    for (let start = 0; start < lines.length; start += chunkSize) {
      const part = lines.slice(start, start + chunkSize)
      result.push({
        start,
        text: part.join('\n') + (start + part.length < lines.length ? '\n' : ''),
        count: part.length,
      })
    }
    return result
  }, [source])
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null)
  const [visible, setVisible] = useState({ start: 0, end: 1 })
  const viewport = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  const selecting = useRef(false)
  const dragging = useRef(false)
  const pending = useRef<Highlighted | null>(null)

  const updateVisible = useCallback(() => {
    const element = viewport.current
    if (!element || selecting.current) return
    const style = getComputedStyle(element)
    const height = (Number.parseFloat(style.lineHeight) || 20.8) * chunkSize
    const top = Math.max(0, element.scrollTop - (Number.parseFloat(style.paddingTop) || 0))
    const start = Math.floor(top / height)
    const end = Math.floor((top + element.clientHeight) / height)
    setVisible((before) => (before.start === start && before.end === end ? before : { start, end }))
  }, [])

  useEffect(() => {
    if (!open) return
    let current = true
    const apply = (result: HighlightResult) => {
      if (!current) return
      pending.current = { chunks, result }
      if (!selecting.current) setHighlighted(pending.current)
    }
    const result = codeHighlighter.highlight(
      { code: source, language, isIncomplete, themes: shikiTheme },
      apply,
    )
    if (result) apply(result)
    return () => {
      current = false
    }
  }, [chunks, source, language, isIncomplete, shikiTheme, open])

  useLayoutEffect(updateVisible, [chunks.length, codeBlockMaxHeight, updateVisible])
  useEffect(() => {
    if (!viewport.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateVisible)
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [updateVisible])

  useEffect(() => {
    const syncSelection = () => {
      const selection = document.getSelection()
      selecting.current =
        dragging.current ||
        Boolean(
          selection && !selection.isCollapsed && viewport.current?.contains(selection.anchorNode),
        )
      if (!selecting.current) {
        if (pending.current) setHighlighted(pending.current)
        updateVisible()
      }
    }
    const release = () => {
      dragging.current = false
      syncSelection()
    }
    document.addEventListener('selectionchange', syncSelection)
    document.addEventListener('pointerup', release)
    document.addEventListener('pointercancel', release)
    return () => {
      document.removeEventListener('selectionchange', syncSelection)
      document.removeEventListener('pointerup', release)
      document.removeEventListener('pointercancel', release)
    }
  }, [updateVisible])

  useEffect(() => {
    if (!open || !isAnimating || !atEnd.current) return
    const frame = requestAnimationFrame(() => {
      const element = viewport.current
      if (element && atEnd.current) {
        element.scrollTop = element.scrollHeight
        updateVisible()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [source, isAnimating, updateVisible, open])

  const maxHeight =
    typeof codeBlockMaxHeight === 'number' &&
    (!Number.isFinite(codeBlockMaxHeight) || codeBlockMaxHeight <= 0)
      ? undefined
      : codeBlockMaxHeight
  return (
    <CodeBlockContainer dir="ltr" language={language} isIncomplete={isIncomplete}>
      <div
        ref={viewport}
        data-streamdown="code-block-body"
        data-language={language}
        className="overflow-x-auto overflow-y-auto"
        style={{ maxHeight }}
        onPointerDown={() => {
          dragging.current = true
          selecting.current = true
        }}
        onScroll={() => {
          const element = viewport.current
          if (element)
            atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
          updateVisible()
        }}
      >
        <pre style={rootStyle(highlighted?.result)}>
          <code>
            {chunks.map((chunk, index) => (
              <CodeChunk
                key={chunk.start}
                chunk={chunk}
                result={
                  index >= visible.start &&
                  index <= visible.end &&
                  highlighted?.chunks[index]?.text === chunk.text
                    ? highlighted.result
                    : undefined
                }
                startLine={startLine}
                lineNumbers={lineNumbers}
              />
            ))}
          </code>
        </pre>
      </div>
    </CodeBlockContainer>
  )
}
