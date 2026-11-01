import { lazy, memo, Suspense } from 'react'

const MarkdownContent = lazy(() =>
  import('./reply-markdown-content').then((module) => ({ default: module.ReplyMarkdown })),
)

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
    <Suspense
      fallback={
        <div className="min-w-0 text-[14px] leading-[1.65] whitespace-pre-wrap wrap-anywhere">
          {/* Markdown ignores leading blank lines; keep the cold preview at the same position. */}
          {text.replace(/^(?:[ \t]*(?:\r\n|\r|\n))+/, '')}
        </div>
      }
    >
      <MarkdownContent text={text} streaming={streaming} stateKey={stateKey} />
    </Suspense>
  )
})
