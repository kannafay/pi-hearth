import type { PermissionMode } from '@/lib/generated/pi'

export const permissionOptions: { value: PermissionMode; label: string; description: string }[] = [
  {
    value: 'ask',
    label: '询问模式',
    description: '项目内读取无需确认，写入文件和运行命令前先询问。',
  },
  {
    value: 'auto',
    label: '模型自动判断',
    description: '由当前模型评估风险，常规操作自动执行，危险或无法确定的操作仍询问。',
  },
  { value: 'full', label: '完全访问', description: '允许读写文件和运行命令，无需逐次确认。' },
]

export const isPermissionMode = (value: unknown): value is PermissionMode =>
  permissionOptions.some((option) => option.value === value)
