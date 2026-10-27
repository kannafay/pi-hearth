import type { ChatMessage, ToolCall } from '@/lib/generated/pi'

const toolActivity: Record<string, string> = {
  read: '正在读取文件…',
  write: '正在写入文件…',
  edit: '正在编辑文件…',
  bash: '正在执行命令…',
  powershell: '正在执行命令…',
}

export function getResponseStatus(message: ChatMessage | null | undefined, tools: ToolCall[]) {
  if (tools.some((tool) => tool.status === 'awaiting_approval')) return '等待确认…'
  for (let index = tools.length - 1; index >= 0; index--) {
    if (tools[index].status === 'running') return toolActivity[tools[index].name] ?? '正在调用工具…'
  }
  if (tools.some((tool) => tool.status === 'queued')) return '正在准备执行…'
  if (message?.role === 'assistant' && message.status === 'streaming') {
    if (message.text.trim()) return message.phase === 'commentary' ? '正在处理…' : '正在生成…'
    if (message.thinking.trim()) return '正在思考…'
  }
  return '等待回复…'
}
