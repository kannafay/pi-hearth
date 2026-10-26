import { code } from '@streamdown/code'
import type { CodeHighlighterPlugin, HighlightOptions, HighlightResult } from 'streamdown'

const highlighter: CodeHighlighterPlugin = code

self.addEventListener(
  'message',
  (event: MessageEvent<{ id: number; options: HighlightOptions }>) => {
    const { id, options } = event.data
    const reply = ({ tokens, bg, fg, rootStyle }: HighlightResult) =>
      self.postMessage({ id, result: { tokens, bg, fg, rootStyle } })
    const result = highlighter.highlight(options, reply)
    if (result) reply(result)
  },
)
