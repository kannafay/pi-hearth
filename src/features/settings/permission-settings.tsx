import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore } from '@/app/store'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isPermissionMode, permissionOptions } from '@/features/conversation/permissions'
import { isDesktop } from '@/lib/desktop'
import { SettingsRow } from './settings-row'

export function PermissionSettings() {
  const { mode, pending, ready, save } = useWorkspaceStore(
    useShallow((state) => ({
      mode: state.defaultPermission,
      pending: state.defaultPermissionPending,
      ready: state.settingsReady,
      save: state.setDefaultPermission,
    })),
  )
  return (
    <SettingsRow
      title="新对话默认权限"
      description="仅用于之后新建的对话，已有会话保留各自的权限。"
      htmlFor="default-permission"
      control={
        <Select
          items={permissionOptions}
          value={mode}
          disabled={!isDesktop() || !ready || pending}
          onValueChange={(value) => {
            if (isPermissionMode(value)) void save(value)
          }}
        >
          <SelectTrigger id="default-permission" aria-label="新对话默认权限" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent width="content">
            <SelectGroup>
              {permissionOptions.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      }
    />
  )
}
