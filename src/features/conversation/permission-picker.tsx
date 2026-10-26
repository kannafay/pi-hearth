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
  const Icon = (permissionOptions.find((item) => item.value === mode) ?? permissionOptions[0]).icon
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
        tone={mode === 'full' ? 'warning' : 'default'}
        data-pending={Boolean(pending) || undefined}
        className="shrink-0 text-[13px] leading-5"
      >
        <Icon aria-hidden strokeWidth={1.6} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent width="content" align="start" className="max-w-80">
        <SelectGroup>
          {permissionOptions.map(({ icon: ItemIcon, ...item }) => (
            <SelectItem
              key={item.value}
              value={item.value}
              description={item.description}
              icon={<ItemIcon aria-hidden strokeWidth={1.6} />}
              tone={item.value === 'full' ? 'warning' : 'default'}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
