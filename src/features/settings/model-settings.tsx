import { useShallow } from 'zustand/react/shallow'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { groupModelsByProvider, modelKey, providerLabel } from '@/features/conversation/models'
import { useConversationStore } from '@/features/conversation/store'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import { SettingsRow } from './settings-row'
import { FieldLabel } from '@/components/ui/field'
import { SettingsListGroup } from './settings-list-group'
import { useState } from 'react'
import { FieldError } from '@/components/ui/field'
import { loadModelCatalog } from '@/lib/resources'
import { SettingsRefreshButton } from './settings-refresh-button'

export function ModelSettings() {
  const models = useConversationStore((state) => state.modelCatalog ?? state.models)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      useConversationStore.setState({ modelCatalog: await loadModelCatalog() })
    } catch (error) {
      setError(String(error))
    } finally {
      setLoading(false)
    }
  }
  const { defaultModel, defaultModelPending, settingsReady, setDefaultModel } = useWorkspaceStore(
    useShallow((state) => ({
      defaultModel: state.defaultModel,
      defaultModelPending: state.defaultModelPending,
      settingsReady: state.settingsReady,
      setDefaultModel: state.setDefaultModel,
    })),
  )
  const groups = groupModelsByProvider(models)
  const displayedDefault = defaultModel
    ? (models.find((item) => modelKey(item) === modelKey(defaultModel)) ?? defaultModel)
    : null
  const defaultProviderLabel = displayedDefault
    ? (groups.find((group) => group.provider === displayedDefault.provider)?.label ??
      providerLabel(displayedDefault))
    : ''
  const disabled = !isDesktop() || !settingsReady
  const unavailable =
    defaultModel && !models.some((item) => modelKey(item) === modelKey(defaultModel))

  return (
    <div>
      <SettingsRow
        title="新对话默认模型"
        control={
          <SettingsRefreshButton
            label="刷新模型列表"
            loading={loading}
            disabled={!isDesktop()}
            onClick={() => void refresh()}
          />
        }
        description={
          displayedDefault
            ? `${displayedDefault.name} · ${defaultProviderLabel}`
            : '尚未设置，新对话将自动选择可用模型。'
        }
      />
      {error && <FieldError>{error}</FieldError>}
      <RadioGroup
        aria-label="新对话默认模型"
        value={defaultModel ? modelKey(defaultModel) : null}
        disabled={disabled}
        readOnly={defaultModelPending}
        aria-busy={defaultModelPending}
        className="mt-5 gap-2"
        onValueChange={(value) => {
          const selected = models.find((item) => modelKey(item) === value)
          if (selected) void setDefaultModel(selected)
        }}
      >
        {groups.map((group) => (
          <SettingsListGroup key={group.provider} title={group.label} count={group.models.length}>
            {group.models.map((item) => (
              <FieldLabel
                key={modelKey(item)}
                data-disabled={disabled || undefined}
                variant="option"
              >
                <RadioGroupItem
                  value={modelKey(item)}
                  aria-label={`${item.name} · ${group.label}`}
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
          </SettingsListGroup>
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
        在 Pi 或 CC Switch 中管理模型和密钥，更新后点击刷新即可读取。
      </p>
    </div>
  )
}
