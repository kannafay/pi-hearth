import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useConversationStore } from './store'
import { isPermissionMode, permissionOptions } from './permissions'

export function PermissionPicker() {
  const { status, readOnly, mode, pending, changePermission } = useConversationStore(
    useShallow((state) => ({
      status: state.status,
      readOnly: state.readOnly,
      mode: state.pendingSettings?.permissionMode ?? state.permissionMode,
      pending: state.settingsPending,
      changePermission: state.changePermission,
    })),
  )
  const Icon = mode === 'full' ? ShieldAlert : mode === 'auto' ? Shield : ShieldCheck
  return (
    <Select
      items={permissionOptions}
      value={mode}
      disabled={!['connecting', 'ready'].includes(status) || Boolean(readOnly)}
      onValueChange={(value) => {
        if (isPermissionMode(value)) void changePermission(value)
      }}
    >
      <SelectTrigger
        aria-label="会话权限"
        size="sm"
        variant="ghost"
        data-pending={Boolean(pending) || undefined}
        className="shrink-0"
      >
        <Icon aria-hidden className="size-3.5 stroke-[1.6]" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent width="content" align="start" className="max-w-80">
        <SelectGroup>
          {permissionOptions.map((item) => (
            <SelectItem key={item.value} value={item.value} description={item.description}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
