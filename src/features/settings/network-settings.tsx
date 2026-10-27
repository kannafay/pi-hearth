import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Globe, LoaderCircle, Monitor, Network, PlugZap, Save } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isDesktop } from '@/lib/desktop'
import { defaultProxySettings, testProxyConnection, validateProxy } from '@/lib/network'
import { toast } from '@/lib/toast'
import type { ProxySettings } from '@/lib/generated/pi'
import { SettingsRow } from './settings-row'

const modes = [
  {
    value: 'inherit',
    label: '默认',
    icon: Monitor,
    description: '沿用本机 Pi 配置和启动环境中的代理。',
  },
  { value: 'direct', label: '直连', icon: Globe, description: '直接连接模型服务。' },
  {
    value: 'manual',
    label: '手动代理',
    icon: Network,
    description: '通过指定的 HTTP、HTTPS 或 SOCKS5 代理连接。',
  },
]

export function NetworkSettings() {
  const { proxy, pending, ready, actionPending, setProxy } = useWorkspaceStore(
    useShallow((state) => ({
      proxy: state.proxy,
      pending: state.proxyPending,
      ready: state.settingsReady,
      actionPending: state.sessionActionPending,
      setProxy: state.setProxy,
    })),
  )
  const busy = useConversationStore(
    (state) =>
      ['connecting', 'running', 'stopping'].includes(state.status) ||
      Boolean(state.settingsPending) ||
      [...state.backgroundSessions.values()].some(({ data }) =>
        ['running', 'stopping'].includes(data.status),
      ),
  )
  const [edit, setEdit] = useState<{ source: ProxySettings; draft: ProxySettings } | null>(null)
  const draft =
    edit?.source === proxy
      ? edit.draft
      : {
          ...proxy,
          noProxy: proxy.noProxy.trim() === defaultProxySettings.noProxy ? '' : proxy.noProxy,
        }
  const setDraft = (draft: ProxySettings) => setEdit({ source: proxy, draft })
  const [target, setTarget] = useState('https://www.google.com/generate_204')
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const unavailable = !isDesktop() || !ready || pending || testing
  const normalized = {
    ...draft,
    url: draft.url.trim(),
    noProxy: draft.noProxy.trim() || defaultProxySettings.noProxy,
  }
  const changed =
    JSON.stringify(normalized) !==
    JSON.stringify({
      ...proxy,
      noProxy: proxy.noProxy.trim() || defaultProxySettings.noProxy,
    })
  const invalid = validateProxy(normalized)
  const {
    label: modeLabel,
    icon: ModeIcon,
    description,
  } = modes.find((mode) => mode.value === draft.mode) ?? modes[0]

  async function save() {
    if (unavailable || busy || actionPending || invalid || !changed) return
    setError('')
    try {
      await setProxy(normalized)
      toast.success('代理设置已保存')
    } catch (reason) {
      setError(String(reason))
    }
  }

  async function test() {
    if (unavailable || invalid) return
    setTesting(true)
    setError('')
    try {
      const result = await testProxyConnection(normalized, target.trim())
      if (result.status >= 200 && result.status < 400)
        toast.success(`连接成功（${result.elapsedMs} ms）`)
      else toast.info(`网络已连通，目标返回 HTTP ${result.status}（${result.elapsedMs} ms）`)
    } catch (reason) {
      toast.error(reason)
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <SettingsRow
        title="代理模式"
        description={description}
        htmlFor="network-proxy-mode"
        descriptionId="network-proxy-mode-description"
        control={
          <Select
            items={modes}
            value={draft.mode}
            disabled={unavailable}
            onValueChange={(mode) => {
              if (mode === 'inherit' || mode === 'direct' || mode === 'manual') {
                setDraft({ ...draft, mode })
                setError('')
              }
            }}
          >
            <SelectTrigger
              id="network-proxy-mode"
              aria-describedby="network-proxy-mode-description"
              className="w-40"
            >
              <SelectValue>
                <ModeIcon aria-hidden className="size-3.5 stroke-[1.6]" />
                <span>{modeLabel}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {modes.map(({ value, label, icon: Icon }) => (
                  <SelectItem key={value} value={value}>
                    <Icon aria-hidden className="size-3.5 self-center stroke-[1.6]" />
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      >
        {draft.mode === 'manual' && (
          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="network-proxy-url">代理地址</FieldLabel>
              <Input
                id="network-proxy-url"
                type="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="http://127.0.0.1:10808"
                value={draft.url}
                disabled={unavailable}
                aria-invalid={Boolean(draft.url && invalid)}
                aria-describedby="network-proxy-url-description"
                onChange={(event) => {
                  setDraft({ ...draft, url: event.target.value })
                  setError('')
                }}
              />
              <FieldDescription id="network-proxy-url-description">
                支持 HTTP、HTTPS 和 SOCKS5，例如 http://127.0.0.1:10808。
              </FieldDescription>
              <FieldError>{draft.url && invalid}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="network-no-proxy">不使用代理的地址</FieldLabel>
              <Input
                id="network-no-proxy"
                autoComplete="off"
                spellCheck={false}
                placeholder={defaultProxySettings.noProxy}
                value={draft.noProxy}
                disabled={unavailable}
                onChange={(event) => setDraft({ ...draft, noProxy: event.target.value })}
              />
              <FieldDescription>多个地址用英文逗号分隔，留空使用默认地址。</FieldDescription>
            </Field>
          </div>
        )}
      </SettingsRow>
      <SettingsRow
        title="测试地址"
        description="使用当前填写的配置测试，无需先保存。"
        htmlFor="network-test-target"
        descriptionId="network-test-target-description"
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={unavailable || Boolean(invalid) || !target.trim()}
            onClick={() => void test()}
          >
            {testing ? (
              <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />
            ) : (
              <PlugZap aria-hidden data-icon="inline-start" />
            )}
            {testing ? '测试中…' : '测试连接'}
          </Button>
        }
      >
        <Input
          id="network-test-target"
          type="url"
          spellCheck={false}
          aria-describedby="network-test-target-description"
          value={target}
          disabled={unavailable}
          onChange={(event) => setTarget(event.target.value)}
        />
      </SettingsRow>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-5">
        <FieldDescription className="min-w-0 flex-1 basis-56 leading-5">
          保存后重新连接当前会话，任务执行期间暂不能应用。
        </FieldDescription>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={unavailable || busy || Boolean(actionPending) || Boolean(invalid) || !changed}
          onClick={() => void save()}
        >
          {pending ? (
            <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />
          ) : (
            <Save aria-hidden data-icon="inline-start" />
          )}
          {pending ? '正在应用…' : '保存并应用'}
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </>
  )
}
