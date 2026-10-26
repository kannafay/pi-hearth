import { toast as toastManager } from '@/components/ui/toast'

export { toastManager }

function notify(type: 'success' | 'error' | 'info', message: string) {
  const title = message.trim()
  if (!title) return
  return toastManager.add({
    id: `${type}:${title}`,
    title,
    type,
    timeout: type === 'error' ? 6500 : 3500,
  })
}

export const toast = {
  success: (message: string) => notify('success', message),
  info: (message: string) => notify('info', message),
  error: (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason ?? '')
    return notify('error', message.replace(/^(?:Error:\s*)+/, '') || '操作未完成，请重试。')
  },
}
