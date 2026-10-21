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
    requestedThinkingLevel,
    changeThinkingLevel,
  } = useConversationStore()
  const items = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'max', label: 'Max' },
  ]
  const selected = requestedThinkingLevel ?? thinkingLevel
  const current = selected === 'xhigh' ? 'max' : selected
  const value = items.some((item) => item.value === current) ? current : null
  const effective = thinkingLevel === 'xhigh' ? 'max' : thinkingLevel
  const effectiveLabel = items.find((item) => item.value === effective)?.label ?? '关闭'

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
          !settingsPending && requestedThinkingLevel && current !== effective
            ? `思考强度：保留所选档位，当前模型实际使用${effectiveLabel}`
            : '思考强度'
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
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
