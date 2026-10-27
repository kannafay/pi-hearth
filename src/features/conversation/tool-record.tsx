import { memo, useState } from 'react'
import { Check, FilePenLine, FileText, LoaderCircle, Terminal, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ToolCall, ToolLogPage } from '@/lib/generated/pi'
import { decidePiTool, loadPiToolOutput } from '@/lib/pi'
import { useConversationStore } from './store'
import { useShallow } from 'zustand/react/shallow'
import { useConversationLocalState } from './conversation-local-state'
import { useExecutionRecord } from './use-execution-record'
import { ExecutionRecord } from './execution-record'

const statusLabels: Record<string, string> = {
  awaiting_approval: '等待确认',
  queued: '准备执行',
  running: '执行中',
  complete: '已完成',
  failed: '执行失败',
  denied: '已拒绝',
  cancelled: '已停止',
  interrupted: '已中断',
}
const toolLabels: Record<string, string> = {
  read: '读取文件',
  write: '写入文件',
  edit: '修改文件',
  bash: '执行命令',
  powershell: '执行命令',
}

function useOutputPage(instanceId: string | null, toolId: string, section: 'arguments' | 'output') {
  const runtimeToolId = useConversationStore((state) => state.runtimeToolIds[toolId] ?? toolId)
  const [page, setPage] = useConversationLocalState<ToolLogPage | null>(
    `tool:${toolId}:${section}`,
    null,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function load() {
    if (!instanceId || loading) return
    setLoading(true)
    setError('')
    try {
      const offset = page?.nextOffset ?? 0
      const next = await loadPiToolOutput(instanceId, runtimeToolId, section, offset)
      setPage({ ...next, content: (offset ? (page?.content ?? '') : '') + next.content })
    } catch (reason) {
      setError(String(reason))
    } finally {
      setLoading(false)
    }
  }
  return { page, loading, error, load }
}

export const ToolRecord = memo(function ToolRecord({ tool }: { tool: ToolCall }) {
  const { instanceId, status, permissionMode } = useConversationStore(
    useShallow((state) => ({
      instanceId: state.instanceId,
      status: state.status,
      permissionMode: state.permissionMode,
    })),
  )
  const awaiting = tool.status === 'awaiting_approval'
  const running = tool.status === 'running' || tool.status === 'queued'
  const [expanded, setExpanded, headerRef] = useExecutionRecord(
    `tool:${tool.id}:expanded`,
    awaiting
      ? 'approval'
      : tool.status === 'running'
        ? 'active'
        : tool.status === 'queued'
          ? 'pending'
          : 'finished',
  )
  const [deciding, setDeciding] = useState(false)
  const [error, setError] = useState('')
  const args = useOutputPage(instanceId, tool.id, 'arguments')
  const output = useOutputPage(instanceId, tool.id, 'output')
  const Icon = ['bash', 'powershell'].includes(tool.name)
    ? Terminal
    : tool.name === 'read'
      ? FileText
      : ['write', 'edit'].includes(tool.name)
        ? FilePenLine
        : Wrench

  async function decide(allow: boolean) {
    if (!instanceId || !tool.approvalId || deciding) return
    setDeciding(true)
    setError('')
    try {
      await decidePiTool(instanceId, tool.approvalId, allow)
      // Keep buttons disabled until the ordered tool event removes the request.
    } catch (reason) {
      setError(String(reason))
      setDeciding(false)
    }
  }

  return (
    <ExecutionRecord
      icon={Icon}
      title={toolLabels[tool.name] ?? tool.name}
      open={expanded}
      onOpenChange={setExpanded}
      headerRef={headerRef}
      disabled={awaiting}
      follow={running}
      aria-label={`${toolLabels[tool.name] ?? tool.name}：${statusLabels[tool.status] ?? tool.status}`}
      summary={
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" />
            }
          >
            {tool.summary}
          </TooltipTrigger>
          <TooltipContent
            showArrow={false}
            className="max-w-[min(36rem,var(--available-width))] whitespace-pre-wrap wrap-anywhere"
          >
            {tool.summary}
          </TooltipContent>
        </Tooltip>
      }
      status={
        <>
          {(running || (awaiting && deciding)) && (
            <LoaderCircle
              aria-hidden
              className="size-3.5 shrink-0 animate-spin text-muted-foreground"
            />
          )}
          <span
            className={`shrink-0 text-xs ${tool.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {statusLabels[tool.status] ?? tool.status}
          </span>
          {tool.durationMs !== null && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {(tool.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">参数</p>
          <pre className="tool-record-code rounded-sm border bg-muted/40 p-2.5 text-xs leading-5 whitespace-pre-wrap wrap-anywhere">
            {args.page?.content ?? tool.arguments}
          </pre>
          {tool.argumentsTruncated && (!args.page || args.page.nextOffset !== null) && (
            <Button
              className="mt-1.5"
              size="xs"
              variant="outline"
              disabled={!instanceId || args.loading}
              onClick={() => void args.load()}
            >
              {args.loading ? '正在加载…' : args.page ? '继续加载参数' : '加载完整参数'}
            </Button>
          )}
          {args.error && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {args.error}
            </p>
          )}
        </div>
        {awaiting && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="w-full text-xs leading-5 text-muted-foreground">
              {tool.name === 'read'
                ? '此文件位于项目外或路径尚未确认。'
                : ['write', 'edit'].includes(tool.name)
                  ? '此操作会修改本地文件。'
                  : '此命令将在当前项目目录执行。'}
              确认有效期为 2 分钟。
              {permissionMode === 'auto' && '自动判断未能确认此操作的风险，需要你确认本次执行。'}
            </p>
            <Button
              size="sm"
              disabled={!instanceId || status === 'stopping' || deciding}
              onClick={() => void decide(true)}
            >
              <Check />
              允许本次
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!instanceId || status === 'stopping' || deciding}
              onClick={() => void decide(false)}
            >
              <X />
              拒绝
            </Button>
            {error && (
              <p role="alert" className="w-full text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        {(tool.output || output.page) && (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">
              {running ? '实时输出' : '执行结果'}
            </p>
            {tool.outputTruncated && !output.page && (
              <p className="mb-1 text-xs text-muted-foreground">
                显示输出末尾；完整接收内容可按需加载。
              </p>
            )}
            <pre className="tool-record-code rounded-sm border bg-muted/40 p-2.5 text-xs leading-5 whitespace-pre-wrap wrap-anywhere">
              {running ? tool.output : (output.page?.content ?? tool.output)}
            </pre>
            {tool.outputTruncated &&
              !running &&
              (!output.page || output.page.nextOffset !== null) && (
                <Button
                  className="mt-1.5"
                  size="xs"
                  variant="outline"
                  disabled={!instanceId || output.loading}
                  onClick={() => void output.load()}
                >
                  {output.loading ? '正在加载…' : output.page ? '继续加载输出' : '加载完整输出'}
                </Button>
              )}
            {output.error && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {output.error}
              </p>
            )}
          </div>
        )}
      </div>
    </ExecutionRecord>
  )
})
