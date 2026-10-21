import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useConversationStore } from './store'
import { groupModelsByProvider, modelKey } from './models'

export function ModelPicker({
  label = '切换模型',
  compact = false,
}: {
  label?: string
  compact?: boolean
}) {
  const { models, model, status, changeModel } = useConversationStore()
  const groups = groupModelsByProvider(models)
  const items = models.map((item) => ({
    value: modelKey(item),
    label: item.name,
  }))
  return (
    <Select
      items={items}
      value={model ? modelKey(model) : null}
      disabled={status !== 'ready' || !models.length}
      onValueChange={(value) => {
        const selected = models.find((item) => modelKey(item) === value)
        if (selected) void changeModel(selected)
      }}
    >
      <SelectTrigger
        aria-label={label}
        size="sm"
        className={compact ? 'composer-select-trigger max-w-64 min-w-0' : 'max-w-72'}
      >
        <SelectValue placeholder="选择模型" />
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        align="start"
        className={compact ? 'composer-select-content' : 'min-w-max'}
      >
        {groups.map((group) => (
          <SelectGroup key={group.provider}>
            <SelectLabel>{group.provider}</SelectLabel>
            {group.models.map((item) => (
              <SelectItem key={modelKey(item)} value={modelKey(item)}>
                {item.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
