import { useContext, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { Copy, Download, Maximize, Table2 } from 'lucide-react'
import {
  StreamdownContext,
  extractTableDataFromElement,
  tableDataToCSV,
  tableDataToMarkdown,
  tableDataToTSV,
  type ExtraProps,
} from 'streamdown'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/icon-button'
import { ScrollArea } from '@/components/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'

type Format = 'md' | 'csv' | 'tsv'
const formats: { value: Format; label: string }[] = [
  { value: 'md', label: 'Markdown' },
  { value: 'csv', label: 'CSV' },
  { value: 'tsv', label: 'TSV' },
]
const actionClass = 'text-muted-foreground'

function TableActionMenu({
  action,
  disabled,
  onSelect,
}: {
  action: '复制' | '下载'
  disabled: boolean
  onSelect: (format: Format) => void
}) {
  const Icon = action === '复制' ? Copy : Download
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${action}表格`}
                  disabled={disabled}
                  className={actionClass}
                />
              }
            />
          }
        >
          <Icon />
        </TooltipTrigger>
        <TooltipContent variant="card" showArrow={false}>
          {action}表格
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-40">
        {formats
          .filter((format) => action === '复制' || format.value !== 'tsv')
          .map(({ value, label }) => (
            <DropdownMenuItem key={value} onClick={() => onSelect(value)}>
              {action}为 {label}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ConversationTable({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<'table'> & ExtraProps) {
  const { isAnimating, tableMaxHeight, controls } = useContext(StreamdownContext)
  const table = useRef<HTMLTableElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const previewViewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const wasStreaming = useRef(isAnimating)
  const [preview, setPreview] = useState(false)
  const options = typeof controls === 'object' ? controls.table : controls
  const enabled = options !== false
  const show = (key: 'copy' | 'download' | 'fullscreen') =>
    enabled && (typeof options !== 'object' || options[key] !== false)

  useLayoutEffect(() => {
    if ((isAnimating || wasStreaming.current) && following.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight
    wasStreaming.current = isAnimating
  }, [children, isAnimating])

  async function act(action: '复制' | '下载', format: Format) {
    if (!table.current) return
    try {
      const data = extractTableDataFromElement(table.current)
      const text =
        format === 'csv'
          ? tableDataToCSV(data, typeof options === 'object' ? options.csvSeparator : undefined)
          : format === 'tsv'
            ? tableDataToTSV(data)
            : tableDataToMarkdown(data)
      if (action === '复制') {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': new Blob([text], { type: 'text/plain' }),
              'text/html': new Blob([table.current.outerHTML], { type: 'text/html' }),
            }),
          ])
        } else await navigator.clipboard.writeText(text)
        toast.success('表格已复制')
      } else {
        const download = typeof options === 'object' ? options.download : undefined
        const filename = typeof download === 'object' ? download.filename : 'table'
        const csv = format === 'csv'
        const url = URL.createObjectURL(
          new Blob([csv ? '\uFEFF' + text : text], {
            type: csv ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8',
          }),
        )
        const link = document.createElement('a')
        link.href = url
        link.download = `${filename}.${format}`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 0)
      }
    } catch {
      toast.error(`${action}表格失败，请重试。`)
    }
  }

  const grid = (original: boolean) => (
    <table
      {...props}
      ref={original ? table : undefined}
      data-streamdown="table"
      className={cn('w-full text-sm leading-5', className)}
    >
      {children}
    </table>
  )

  const actions = (expand: boolean) => (
    <div className="conversation-table-actions flex shrink-0 items-center gap-0.5 px-0.5">
      {show('download') && (
        <TableActionMenu
          action="下载"
          disabled={isAnimating}
          onSelect={(format) => void act('下载', format)}
        />
      )}
      {show('copy') && (
        <TableActionMenu
          action="复制"
          disabled={isAnimating}
          onSelect={(format) => void act('复制', format)}
        />
      )}
      {expand && show('fullscreen') && (
        <IconButton
          label="放大表格"
          size="icon-sm"
          className={actionClass}
          disabled={isAnimating}
          onClick={() => setPreview(true)}
        >
          <Maximize />
        </IconButton>
      )}
    </div>
  )

  return (
    <div className="conversation-table min-w-0 max-w-full border" data-streamdown="table-wrapper">
      <div className="conversation-table-header flex min-h-9 items-center gap-2 px-1">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
          <Table2 aria-hidden className="size-3.5 shrink-0 stroke-[1.6]" />
          表格
        </span>
        {actions(true)}
      </div>
      <ScrollArea
        ref={viewport}
        role="region"
        aria-label="表格内容"
        tabIndex={0}
        style={{ maxHeight: tableMaxHeight }}
        viewportClassName="conversation-table-scroll"
        onScroll={() => {
          const element = viewport.current
          if (element)
            following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48
        }}
      >
        {grid(true)}
      </ScrollArea>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent layout="preview" initialFocus={previewViewport}>
          <DialogHeader variant="compact" className="flex-row items-center justify-between pr-9">
            <DialogTitle>表格</DialogTitle>
            <DialogDescription className="sr-only">
              完整表格预览，可滚动查看全部内容。
            </DialogDescription>
            {actions(false)}
          </DialogHeader>
          <ScrollArea
            ref={previewViewport}
            role="region"
            aria-label="完整表格内容"
            tabIndex={0}
            className="conversation-table min-h-0 border"
            viewportClassName="h-full"
          >
            {grid(false)}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}
