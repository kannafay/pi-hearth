import { useShallow } from 'zustand/react/shallow'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { thinkingCapabilitiesPending, useConversationStore } from './store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function ThinkingPicker({
  open,
  onOpenChange,
}: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const {
    status,
    readOnly,
    settingsPending,
    thinkingLevel,
    availableThinkingLevels,
    capabilitiesPending,
    requestedThinkingLevel,
    changeThinkingLevel,
  } = useConversationStore(
    useShallow((state) => ({
      status: state.status,
      readOnly: state.readOnly,
      settingsPending: state.settingsPending,
      thinkingLevel: state.thinkingLevel,
      availableThinkingLevels: state.availableThinkingLevels,
      requestedThinkingLevel: state.pendingSettings?.thinkingLevel ?? state.requestedThinkingLevel,
      capabilitiesPending: thinkingCapabilitiesPending(state),
      changeThinkingLevel: state.changeThinkingLevel,
    })),
  )
  const items = [
    { value: 'default', label: 'Default' },
    { value: 'off', label: 'Off' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'XHigh' },
    { value: 'max', label: 'Max' },
  ]
  const value = requestedThinkingLevel ?? 'default'
  const effectiveLabel = items.find((item) => item.value === thinkingLevel)?.label ?? '关闭'

  return (
    <Select
      open={open}
      onOpenChange={onOpenChange}
      items={items}
      value={value}
      disabled={status === 'disconnected' || Boolean(readOnly)}
      onValueChange={(level) => {
        if (level) void changeThinkingLevel(level)
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SelectTrigger
              aria-label="思考强度"
              data-pending={Boolean(settingsPending) || undefined}
              size="sm"
              variant="ghost"
              className="shrink-0 text-[13px] leading-5"
            />
          }
        >
          <SelectValue placeholder="思考强度" />
        </TooltipTrigger>
        <TooltipContent showArrow={false}>
          {value === 'default'
            ? `跟随模型默认设置，当前使用 ${effectiveLabel}`
            : `思考强度：${effectiveLabel}`}
        </TooltipContent>
      </Tooltip>
      <SelectContent alignItemWithTrigger={false} align="start" width="content">
        <SelectGroup>
          {items.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              disabled={
                item.value !== 'default' &&
                !capabilitiesPending &&
                !availableThinkingLevels.includes(item.value)
              }
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
