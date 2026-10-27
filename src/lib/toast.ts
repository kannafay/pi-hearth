import { toast as toastManager } from '@/components/ui/toast'

export { toastManager }

const compactionNotices = new Map([
  ['Nothing to compact (session too small)', '当前会话内容较少，暂时无需压缩。'],
  ['Already compacted', '当前上下文已压缩，暂时无需重复压缩。'],
])

function notify(type: 'success' | 'error' | 'info', message: string) {
  const title = message.trim()
  if (!title) return
  return toastManager.add({
    id: `${type}:${title}`,
    title,
    type,
    // The renderer pauses remaining time on hover, but still expires inactive-window notices.
    timeout: 0,
    data: { dismissAfter: type === 'error' ? 6500 : 3500 },
  })
}

export const toast = {
  success: (message: string) => notify('success', message),
  info: (message: string) => notify('info', message),
  error: (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason ?? '')
    const title = message.trim().replace(/^(?:Error:\s*)+/, '')
    const notice = compactionNotices.get(title)
    return notice ? notify('info', notice) : notify('error', title || '操作未完成，请重试。')
  },
}
