import type { ModelInfo } from '@/lib/generated/pi'

export const modelKey = (model: ModelInfo) => `${model.provider}/${model.id}`

export const providerLabel = (model: ModelInfo) => model.providerName?.trim() || model.provider

export function groupModelsByProvider(models: ModelInfo[]) {
  const groups = new Map<string, ModelInfo[]>()
  for (const model of models) {
    const items = groups.get(model.provider)
    if (items) items.push(model)
    else groups.set(model.provider, [model])
  }
  return Array.from(groups, ([provider, models]) => ({
    provider,
    label: providerLabel(models.find((model) => model.providerName?.trim()) ?? models[0]),
    models,
  }))
}
