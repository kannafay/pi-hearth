import type { PermissionMode } from '@/lib/generated/pi'

export const permissionOptions: { value: PermissionMode; label: string; description: string }[] = [
  {
    value: 'ask',
    label: '询问模式',
    description: '写文件、运行命令前询问',
  },
  {
    value: 'auto',
    label: '模型自动判断',
    description: '常规自动执行，危险或不确定时询问',
  },
  { value: 'full', label: '完全访问', description: '读写文件、运行命令无需确认' },
]

export const isPermissionMode = (value: unknown): value is PermissionMode =>
  permissionOptions.some((option) => option.value === value)
