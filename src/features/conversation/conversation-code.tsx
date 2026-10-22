import { useContext, type ComponentProps } from 'react'
import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockDownloadButton,
  defaultComponents,
  StreamdownContext,
  useIsCodeFenceIncomplete,
  type ExtraProps,
} from 'streamdown'
import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const actionClass = buttonVariants({
  variant: 'ghost',
  size: 'icon-sm',
  className: 'text-muted-foreground duration-150 hover:text-foreground',
})

export function ConversationCode({
  children,
  className,
  node,
  ...props
}: ComponentProps<'code'> & ExtraProps & { 'data-block'?: string }) {
  const isIncomplete = useIsCodeFenceIncomplete()
  const { lineNumbers } = useContext(StreamdownContext)

  if (!('data-block' in props)) {
    return (
      <defaultComponents.code className={className} node={node} {...props}>
        {children}
      </defaultComponents.code>
    )
  }

  const language = className?.match(/language-([^\s]+)/)?.[1] ?? ''
  const meta = String(node?.properties?.metastring ?? '')
  const startLine = Number(meta.match(/\bstartLine=(\d+)\b/)?.[1]) || 1
  const code = typeof children === 'string' ? children : ''

  return (
    <CodeBlock
      code={code}
      language={language || 'text'}
      isIncomplete={isIncomplete}
      lineNumbers={lineNumbers && !/\bnoLineNumbers\b/.test(meta)}
      startLine={startLine}
    >
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <CodeBlockDownloadButton
            code={code}
            language={language}
            aria-label="下载代码"
            title={undefined}
            className={actionClass}
          />
        </TooltipTrigger>
        <TooltipContent variant="card" showArrow={false}>
          下载代码
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <CodeBlockCopyButton
            code={code}
            aria-label="复制代码"
            title={undefined}
            className={actionClass}
          />
        </TooltipTrigger>
        <TooltipContent variant="card" showArrow={false}>
          复制代码
        </TooltipContent>
      </Tooltip>
    </CodeBlock>
  )
}
