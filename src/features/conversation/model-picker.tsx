import { useShallow } from 'zustand/react/shallow'
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
  const { runtimeModels, modelCatalog, model, status, readOnly, settingsPending, changeModel } =
    useConversationStore(
      useShallow((state) => ({
        runtimeModels: state.models,
        modelCatalog: state.modelCatalog,
        model: state.pendingSettings?.model ?? state.model,
        status: state.status,
        readOnly: state.readOnly,
        settingsPending: state.settingsPending,
        changeModel: state.changeModel,
      })),
    )
  // Refresh display metadata without changing the runtime's selectable models.
  const models = runtimeModels.map(
    (model) => modelCatalog?.find((item) => modelKey(item) === modelKey(model)) ?? model,
  )
  const groups = groupModelsByProvider(models)
  const items = models.map((item) => ({
    value: modelKey(item),
    label: item.name,
  }))
  return (
    <Select
      items={items}
      value={model ? modelKey(model) : null}
      disabled={!['connecting', 'ready'].includes(status) || Boolean(readOnly) || !models.length}
      onValueChange={(value) => {
        const selected = models.find((item) => modelKey(item) === value)
        if (selected) void changeModel(selected)
      }}
    >
      <SelectTrigger
        aria-label={label}
        data-pending={Boolean(settingsPending) || undefined}
        size="sm"
        variant={compact ? 'ghost' : 'default'}
        className={compact ? 'max-w-64 min-w-0 text-[13px] leading-5' : 'max-w-72'}
      >
        <SelectValue placeholder="选择模型" />
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        align="start"
        width={compact ? 'content' : 'default'}
        className={compact ? undefined : 'min-w-max'}
      >
        {groups.map((group) => (
          <SelectGroup key={group.provider}>
            <SelectLabel>{group.label}</SelectLabel>
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
