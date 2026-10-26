import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react'
import { ChevronRight, CodeXml } from 'lucide-react'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useConversationLocalState } from './conversation-local-state'

const CodeScope = createContext<string | undefined>(undefined)

export function ConversationCodeState({
  stateKey,
  children,
}: {
  stateKey: string
  children: ReactNode
}) {
  return <CodeScope.Provider value={stateKey}>{children}</CodeScope.Provider>
}

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
    <FencedCode
      code={code}
      language={language}
      meta={meta}
      startLine={startLine}
      offset={node?.position?.start.offset}
    />
  )
}

function FencedCode({
  code,
  language,
  meta,
  startLine,
  offset,
}: {
  code: string
  language: string
  meta: string
  startLine: number
  offset?: number
}) {
  const isIncomplete = useIsCodeFenceIncomplete()
  const context = useContext(StreamdownContext)
  const scope = useContext(CodeScope)
  const fallbackKey = useId()
  const streaming = context.isAnimating
  const [choice, setChoice] = useConversationLocalState<{
    streaming: boolean
    open: boolean
  } | null>(
    !streaming && scope ? `code:${scope}:${offset ?? fallbackKey}:expanded` : undefined,
    null,
  )
  // A completed reply starts collapsed, even if its code fence closed before the reply finished.
  const open = choice?.streaming === streaming ? choice.open : streaming

  return (
    <Collapsible
      open={open}
      onOpenChange={(open) => setChoice({ streaming, open })}
      className="conversation-code min-w-0 max-w-full border"
    >
      <div className="conversation-code-header flex min-h-9 min-w-0 items-center gap-2 px-1">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-2 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <CodeXml aria-hidden className="size-3.5 shrink-0 stroke-[1.6]" />
          <span className="truncate">{language || '代码'}</span>
          <ChevronRight
            aria-hidden
            className={`size-3.5 shrink-0 transition-transform duration-160 ease-out ${open ? 'rotate-90' : ''}`}
          />
        </CollapsibleTrigger>
        <div data-streamdown="code-block-actions" className="flex shrink-0 items-center">
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
        </div>
      </div>
      <CollapsibleContent className="conversation-code-content">
        <CodeBlock
          code={code}
          language={language || 'text'}
          isIncomplete={isIncomplete}
          lineNumbers={context.lineNumbers && !/\bnoLineNumbers\b/.test(meta)}
          startLine={startLine}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}
