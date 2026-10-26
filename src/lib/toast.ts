import { toast as toastManager } from '@/components/ui/toast'

export { toastManager }

function notify(type: 'success' | 'error' | 'info', message: string) {
  const description = message.trim()
  if (!description) return
  const id = `${type}:${description}`
  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(description)
      toastManager.update(id, { actionProps: { children: '已复制', disabled: true } })
    } catch {
      toastManager.update(id, {
        actionProps: { children: '复制失败', onClick: () => void copyDetails() },
      })
    }
  }
  return toastManager.add({
    id,
    title: { success: '操作成功', error: '操作失败', info: '提示' }[type],
    description,
    type,
    actionProps:
      type === 'error' ? { children: '复制', onClick: () => void copyDetails() } : undefined,
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
