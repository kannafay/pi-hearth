import type { ChatMessage, ToolCall } from '@/lib/generated/pi'

export function getResponseStatus(message: ChatMessage | null | undefined, tools: ToolCall[]) {
  if (tools.some((tool) => tool.status === 'awaiting_approval')) return '等待确认…'
  if (tools.some((tool) => tool.status === 'running')) return '正在执行工具…'
  if (message?.role === 'assistant' && message.status === 'streaming') {
    if (message.text.trim()) return '正在生成…'
    if (message.thinking.trim()) return '正在思考…'
  }
  return '等待回复…'
}
