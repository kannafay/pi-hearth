import { ShieldAlert, ShieldCheck, ShieldEllipsis, type LucideIcon } from 'lucide-react'
import type { PermissionMode } from '@/lib/generated/pi'

export const permissionOptions: {
  value: PermissionMode
  label: string
  description: string
  icon: LucideIcon
}[] = [
  {
    value: 'ask',
    label: '询问模式',
    description: '写文件、运行命令前询问',
    icon: ShieldCheck,
  },
  {
    value: 'auto',
    label: '自动评估',
    description: '模型评估风险，常规自动，危险或不确定时询问',
    icon: ShieldEllipsis,
  },
  {
    value: 'full',
    label: '完全访问',
    description: '读写文件、运行命令无需确认',
    icon: ShieldAlert,
  },
]

export const isPermissionMode = (value: unknown): value is PermissionMode =>
  permissionOptions.some((option) => option.value === value)
