import { useShallow } from 'zustand/react/shallow'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { groupModelsByProvider, modelKey } from '@/features/conversation/models'
import { useConversationStore } from '@/features/conversation/store'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import { SettingsRow } from './settings-row'
import { FieldLabel } from '@/components/ui/field'

export function ModelSettings() {
  const models = useConversationStore((state) => state.models)
  const { defaultModel, defaultModelPending, settingsReady, setDefaultModel } = useWorkspaceStore(
    useShallow((state) => ({
      defaultModel: state.defaultModel,
      defaultModelPending: state.defaultModelPending,
      settingsReady: state.settingsReady,
      setDefaultModel: state.setDefaultModel,
    })),
  )
  const groups = groupModelsByProvider(models)
  const disabled = !isDesktop() || !settingsReady || defaultModelPending
  const unavailable =
    defaultModel && !models.some((item) => modelKey(item) === modelKey(defaultModel))

  return (
    <div>
      <SettingsRow
        title="新对话默认模型"
        description={
          defaultModel
            ? `${defaultModel.name} · ${defaultModel.provider}`
            : '尚未设置，新对话将自动选择可用模型。'
        }
      />
      <RadioGroup
        aria-label="新对话默认模型"
        value={defaultModel ? modelKey(defaultModel) : null}
        disabled={disabled}
        className="mt-5 gap-2"
        onValueChange={(value) => {
          const selected = models.find((item) => modelKey(item) === value)
          if (selected) void setDefaultModel(selected)
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
                  <FieldLabel
                    key={modelKey(item)}
                    data-disabled={disabled || undefined}
                    variant="option"
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
                  </FieldLabel>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </RadioGroup>
      {!groups.length && <p className="mt-5 text-xs text-muted-foreground">暂无可用模型</p>}
      {unavailable && groups.length > 0 && (
        <p role="status" className="mt-5 text-xs leading-6 text-muted-foreground">
          保存的默认模型当前不可用，新对话将自动选择可用模型。你可以重新选择默认模型。
        </p>
      )}
      <p className="mt-5 text-xs leading-6 text-muted-foreground">
        默认模型仅对之后新建的对话生效，已有会话保持各自的模型，也可以在消息输入区单独切换。
      </p>
      <p className="mt-3 text-xs leading-6 text-muted-foreground">
        在 Pi 或 CC Switch 中管理模型和密钥，更新后新建聊天即可读取。
      </p>
    </div>
  )
}
