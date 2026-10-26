import { useConversationStore } from '@/features/conversation/store'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FolderOpen } from 'lucide-react'
import { FieldDescription, FieldError } from '@/components/ui/field'
import { isDesktop } from '@/lib/desktop'
import { SettingsRefreshButton } from './settings-refresh-button'
import { SettingsListGroup } from './settings-list-group'
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
      {state.error && <FieldError>{state.error}</FieldError>}
      {!state.loading && entries?.length === 0 && (
        <p className="text-xs leading-6 text-muted-foreground">
          未发现{kind === 'skills' ? '技能' : ' MCP 服务配置'}。
        </p>
      )}
      {Boolean(entries?.length) && (
        <ul className="space-y-2">
          {entries?.map((item) => (
            <li key={`${kind}:${item.source}:${item.name}`}>
              <SettingsListGroup
                title={item.name}
                control={
                  <Switch
                    aria-label={`${label} ${item.name}`}
                    checked={item.enabled}
                    disabled={Boolean(disabled)}
                    onCheckedChange={(enabled) => void state.setEnabled(kind, item, enabled)}
                  />
                }
              >
                <div className="space-y-3 p-2 text-xs">
                  <dl className="space-y-3">
                    <div className="space-y-1">
                      <dt className="text-muted-foreground">
                        {kind === 'skills' ? '说明' : '服务类型'}
                      </dt>
                      <dd className="leading-5 wrap-anywhere">{item.description || '暂无说明'}</dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-muted-foreground">来源</dt>
                      <dd>
                        {{ global: '全局', project: '当前项目', custom: '自定义路径' }[item.scope]}
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-muted-foreground">
                        {kind === 'skills' ? '技能文件' : '配置文件'}
                      </dt>
                      <dd className="font-mono leading-5 break-all">{item.source}</dd>
                    </div>
                    {kind === 'skills' && (
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">调用方式</dt>
                        <dd>{item.manualOnly ? '仅手动调用' : '允许模型自动选择'}</dd>
                      </div>
                    )}
                    {kind === 'mcp' && item.configuration && (
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">连接配置</dt>
                        <dd>
                          <pre className="tool-record-code max-h-60 overflow-auto rounded-sm border bg-muted/40 p-2.5 font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere">
                            {item.configuration}
                          </pre>
                        </dd>
                      </div>
                    )}
                  </dl>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isDesktop()}
                    onClick={() => void state.open(kind, item)}
                  >
                    <FolderOpen />
                    {kind === 'skills' ? '打开目录' : '编辑配置'}
                  </Button>
                </div>
              </SettingsListGroup>
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
