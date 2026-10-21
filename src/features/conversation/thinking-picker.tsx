import { BrainCircuit } from 'lucide-react'
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
  const { status, readOnly, thinkingLevel, availableThinkingLevels, changeThinkingLevel } =
    useConversationStore()
  const max = availableThinkingLevels.includes('max') ? 'max' : 'xhigh'
  const items = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: max, label: 'Max' },
  ]
  const supported = items.some((item) => availableThinkingLevels.includes(item.value))
  const value = items.some((item) => item.value === thinkingLevel) ? thinkingLevel : null

  return (
    <Select
      items={items}
      value={value}
      disabled={status !== 'ready' || Boolean(readOnly)}
      onValueChange={(level) => {
        if (level) void changeThinkingLevel(level)
      }}
    >
      <SelectTrigger
        aria-label="思考强度"
        title={supported ? '思考强度' : '当前模型不支持调节思考强度'}
        size="sm"
        className="composer-select-trigger shrink-0"
      >
        <BrainCircuit className="size-3.5 stroke-[1.6]" />
        <SelectValue placeholder="思考强度" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="composer-select-content">
        <SelectGroup>
          {items.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              disabled={!availableThinkingLevels.includes(item.value)}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
