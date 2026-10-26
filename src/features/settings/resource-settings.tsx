import { useConversationStore } from '@/features/conversation/store'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FieldDescription, FieldError } from '@/components/ui/field'
import { isDesktop } from '@/lib/desktop'
import { SettingsRefreshButton } from './settings-refresh-button'
import type { ResourceCatalogState } from './use-resource-catalog'
import type { ResourceKind } from '@/lib/resources'

export function ResourceSettings({
  kind,
  state,
}: {
  kind: ResourceKind
  state: ResourceCatalogState
}) {
  const status = useConversationStore((store) => store.status)
  const label = kind === 'skills' ? '技能' : 'MCP'
  const entries = state.catalog?.[kind]
  const disabled =
    !isDesktop() ||
    state.loading ||
    state.pending ||
    ['running', 'stopping', 'connecting'].includes(status)
  return (
    <div aria-busy={state.loading || Boolean(state.pending)} className="space-y-5 pt-5">
      <div className="flex items-center justify-between gap-3">
        <FieldDescription>
          {entries
            ? `已启用 ${entries.filter((item) => item.enabled).length} / ${entries.length} 项`
            : '本机配置'}
        </FieldDescription>
        <SettingsRefreshButton
          label={`刷新${label}列表`}
          loading={state.loading}
          disabled={!isDesktop() || Boolean(state.pending)}
          onClick={state.refresh}
        />
      </div>
      {state.loading && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取{label}列表…
        </p>
      )}
      {state.error && <FieldError>{state.error}</FieldError>}
      {!state.loading && entries?.length === 0 && (
        <p className="text-xs leading-6 text-muted-foreground">
          未发现{kind === 'skills' ? '技能' : ' MCP 服务配置'}。
        </p>
      )}
      {Boolean(entries?.length) && (
        <ul className="divide-y overflow-hidden rounded-md border">
          {entries?.map((item) => (
            <li
              key={`${item.source}:${item.name}`}
              className="flex min-w-0 items-center gap-3 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="link"
                        size="sm"
                        className="w-fit min-w-0 max-w-full justify-start px-0 font-normal"
                        disabled={!isDesktop()}
                        onClick={() => void state.open(kind, item)}
                      />
                    }
                  >
                    <span className="truncate">{item.name}</span>
                  </TooltipTrigger>
                  <TooltipContent align="start" className="wrap-anywhere" showArrow={false}>
                    {item.source}
                  </TooltipContent>
                </Tooltip>
              </div>
              <Switch
                aria-label={`${label} ${item.name}`}
                checked={item.enabled}
                disabled={Boolean(disabled)}
                onCheckedChange={(enabled) => void state.setEnabled(kind, item, enabled)}
              />
            </li>
          ))}
        </ul>
      )}
      {state.catalog?.warnings.map((warning) => (
        <p key={warning} className="text-xs leading-5 text-muted-foreground">
          {warning}
        </p>
      ))}
    </div>
  )
}
