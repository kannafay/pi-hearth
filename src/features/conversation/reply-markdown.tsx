import { memo } from 'react'
import { Streamdown } from 'streamdown'
import { Check, Copy, Download } from 'lucide-react'
import { codeHighlighter } from './code-highlighter'
import {
  ConversationCode,
  ConversationCodeState,
  ConversationMarkdownBlock,
} from './conversation-code'

const components = { code: ConversationCode }
const icons = { CheckIcon: Check, CopyIcon: Copy, DownloadIcon: Download }
const translations = { copyCode: '复制代码', copied: '已复制', downloadFile: '下载代码' }
const plugins = { code: codeHighlighter }

export const ReplyMarkdown = memo(function ReplyMarkdown({
  text,
  streaming,
  stateKey,
}: {
  text: string
  streaming: boolean
  stateKey: string
}) {
  return (
    <ConversationCodeState key={stateKey} stateKey={stateKey}>
      <Streamdown
        plugins={plugins}
        components={components}
        icons={icons}
        translations={translations}
        isAnimating={streaming}
        mode="streaming"
        parseIncompleteMarkdown={streaming}
        BlockComponent={ConversationMarkdownBlock}
        className="conversation-markdown min-w-0 space-y-3 text-[14px] leading-[1.65] wrap-anywhere"
      >
        {text}
      </Streamdown>
    </ConversationCodeState>
  )
})
