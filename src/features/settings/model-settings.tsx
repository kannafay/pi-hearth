import { useShallow } from 'zustand/react/shallow'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { groupModelsByProvider, modelKey } from '@/features/conversation/models'
import { useConversationStore } from '@/features/conversation/store'
import { SettingsPageHeader } from './settings-page-header'

export function ModelSettings() {
  const { models, model, status, readOnly, settingsPending, changeModel } = useConversationStore(
    useShallow((state) => ({
      models: state.models,
      model: state.model,
      status: state.status,
      readOnly: state.readOnly,
      settingsPending: state.settingsPending,
      changeModel: state.changeModel,
    })),
  )
  const groups = groupModelsByProvider(models)
  const disabled = status !== 'ready' || Boolean(readOnly) || Boolean(settingsPending)

  return (
    <div>
      <SettingsPageHeader title="模型与凭证" description="使用本机 Pi 配置，兼容 CC Switch。" />
      <div className="border-b py-5">
        <h3 className="text-sm font-normal">当前模型</h3>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {model ? `${model.name} · ${model.provider}` : '尚未选择模型'}
        </p>
      </div>
      <RadioGroup
        aria-label="可用模型"
        value={model ? modelKey(model) : null}
        disabled={disabled}
        className="mt-5 gap-2"
        onValueChange={(value) => {
          const selected = models.find((item) => modelKey(item) === value)
          if (selected) void changeModel(selected)
        }}
      >
        {groups.map((group) => (
          <Collapsible key={group.provider} className="overflow-hidden rounded-md border">
            <CollapsibleTrigger className="flex h-10 w-full items-center gap-2 px-3 text-left text-[13px] transition-colors duration-160 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-(--dialog-ease) in-data-panel-open:rotate-90" />
              <span className="min-w-0 flex-1 truncate">{group.provider}</span>
              <span className="text-xs text-muted-foreground" aria-hidden>
                {group.models.length}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent
              role="group"
              aria-label={group.provider}
              className="settings-model-content"
            >
              <div className="border-t p-1">
                {group.models.map((item) => (
                  <label
                    key={modelKey(item)}
                    data-disabled={disabled || undefined}
                    className="flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 transition-colors duration-160 ease-(--dialog-ease) hover:bg-accent has-[:focus-visible]:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-50"
                  >
                    <RadioGroupItem
                      value={modelKey(item)}
                      aria-label={`${item.name} · ${item.provider}`}
                    />
                    <span className="min-w-0 text-[13px]">
                      <span className="block truncate">{item.name}</span>
                      {item.id !== item.name && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.id}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </RadioGroup>
      {!groups.length && <p className="mt-5 text-xs text-muted-foreground">暂无可用模型</p>}
      <p className="mt-5 text-xs leading-6 text-muted-foreground">
        在 Pi 或 CC Switch
        中管理模型和密钥，更新后新建聊天即可读取。也可以直接在消息输入区切换模型。
      </p>
    </div>
  )
}
