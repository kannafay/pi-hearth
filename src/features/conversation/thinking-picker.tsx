import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useConversationStore } from './store'

export function ThinkingPicker() {
  const {
    status,
    readOnly,
    settingsPending,
    thinkingLevel,
    availableThinkingLevels,
    requestedThinkingLevel,
    changeThinkingLevel,
  } = useConversationStore()
  const items = [
    { value: 'default', label: 'Default' },
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
      items={items}
      value={value}
      disabled={status !== 'ready' || Boolean(readOnly) || Boolean(settingsPending)}
      onValueChange={(level) => {
        if (level) void changeThinkingLevel(level)
      }}
    >
      <SelectTrigger
        aria-label="思考强度"
        title={
          value === 'default'
            ? `跟随模型默认设置，当前使用 ${effectiveLabel}`
            : `思考强度：${effectiveLabel}`
        }
        data-pending={Boolean(settingsPending) || undefined}
        size="sm"
        className="composer-select-trigger shrink-0"
      >
        <SelectValue placeholder="思考强度" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="composer-select-content">
        <SelectGroup>
          {items.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              disabled={item.value !== 'default' && !availableThinkingLevels.includes(item.value)}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
