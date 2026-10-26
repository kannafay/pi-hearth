import { LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldDescription, FieldError } from '@/components/ui/field'
import { isDesktop } from '@/lib/desktop'
import { SettingsRow } from './settings-row'
import { SettingsListGroup } from './settings-list-group'
import type { ResourceCatalogState } from './use-resource-catalog'

const scopes = [
  { value: 'global', label: '全局' },
  { value: 'project', label: '当前项目' },
  { value: 'custom', label: '额外路径' },
] as const

export function ResourceSettings({
  kind,
  state,
}: {
  kind: 'skills' | 'mcp'
  state: ResourceCatalogState
}) {
  const label = kind === 'skills' ? '技能' : 'MCP'
  const entries = state.catalog?.[kind]
  // Keep this status aligned with the runtime's --no-skills / --no-mcp flags.
  return (
    <div aria-busy={state.loading} className="space-y-5">
      <SettingsRow
        title="当前已启用"
        value="0 项"
        description={`当前客户端尚未加载${label}，以下为本机和当前项目可发现的配置。`}
      />
      <div className="flex items-center justify-between gap-3">
        <FieldDescription>{entries ? `已发现 ${entries.length} 项` : '本机配置'}</FieldDescription>
        <Button
          variant="outline"
          size="sm"
          disabled={!isDesktop() || state.loading}
          aria-label={`刷新${label}列表`}
          onClick={state.refresh}
        >
          {state.loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          刷新
        </Button>
      </div>
      {state.loading && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取{label}列表…
        </p>
      )}
      {state.error && <FieldError>{state.error}</FieldError>}
      {!state.loading && entries && entries.length === 0 && (
        <p className="text-xs leading-6 text-muted-foreground">
          未发现{label === '技能' ? '技能' : ' MCP 服务配置'}。
        </p>
      )}
      {entries &&
        scopes.map((scope) => {
          const items = entries.filter((item) => item.scope === scope.value)
          return items.length ? (
            <SettingsListGroup key={scope.value} title={scope.label} count={items.length}>
              <ul className="divide-y">
                {items.map((item) => (
                  <li key={`${item.source}:${item.name}`} className="space-y-1 px-2 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-[13px] leading-5 wrap-anywhere">
                        {item.name}
                      </span>
                      <span className="shrink-0 text-xs leading-5 text-muted-foreground">
                        {item.status === 'disabled' ? '配置已禁用' : '未加载'}
                      </span>
                    </div>
                    <p className="text-xs leading-5 wrap-anywhere text-muted-foreground">
                      {item.description}
                    </p>
                    {item.manualOnly && (
                      <p className="text-xs text-muted-foreground">调用方式：仅手动调用</p>
                    )}
                    <p className="text-xs leading-5 wrap-anywhere text-muted-foreground">
                      {item.source}
                    </p>
                  </li>
                ))}
              </ul>
            </SettingsListGroup>
          ) : null
        })}
      {state.catalog?.warnings.map((warning) => (
        <p key={warning} className="text-xs leading-5 text-muted-foreground">
          {warning}
        </p>
      ))}
    </div>
  )
}
