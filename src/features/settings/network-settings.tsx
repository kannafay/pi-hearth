import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { LoaderCircle } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isDesktop } from '@/lib/desktop'
import { testProxyConnection, validateProxy } from '@/lib/network'
import { toast } from '@/lib/toast'
import type { ProxySettings } from '@/lib/generated/pi'
import { SettingsRow } from './settings-row'

const modes = [
  { value: 'inherit', label: '默认' },
  { value: 'direct', label: '直连' },
  { value: 'manual', label: '手动代理' },
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
  const draft = edit?.source === proxy ? edit.draft : proxy
  const setDraft = (draft: ProxySettings) => setEdit({ source: proxy, draft })
  const [target, setTarget] = useState('https://www.google.com/generate_204')
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const unavailable = !isDesktop() || !ready || pending || testing
  const normalized = { ...draft, url: draft.url.trim(), noProxy: draft.noProxy.trim() }
  const changed = JSON.stringify(normalized) !== JSON.stringify(proxy)
  const invalid = validateProxy(normalized)

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
        description="默认沿用本机 Pi 配置和启动环境中的代理。"
        htmlFor="network-proxy-mode"
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
            <SelectTrigger id="network-proxy-mode" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modes.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {draft.mode === 'manual' && (
        <div className="space-y-4 border-b py-5">
          <Field>
            <FieldLabel htmlFor="network-proxy-url">代理地址</FieldLabel>
            <Input
              id="network-proxy-url"
              type="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="http://127.0.0.1:7890"
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
              支持 HTTP、HTTPS 和 SOCKS5，例如 socks5://127.0.0.1:7890。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="network-no-proxy">不使用代理的地址</FieldLabel>
            <Input
              id="network-no-proxy"
              autoComplete="off"
              spellCheck={false}
              value={draft.noProxy}
              disabled={unavailable}
              onChange={(event) => setDraft({ ...draft, noProxy: event.target.value })}
            />
            <FieldDescription>
              多个地址用英文逗号分隔。本机模型和本地回调默认直连。
            </FieldDescription>
          </Field>
        </div>
      )}
      <div className="space-y-4 border-b py-5">
        <Field>
          <FieldLabel htmlFor="network-test-target">测试地址</FieldLabel>
          <Input
            id="network-test-target"
            type="url"
            spellCheck={false}
            value={target}
            disabled={unavailable}
            onChange={(event) => setTarget(event.target.value)}
          />
          <FieldDescription>使用当前填写的配置测试，无需先保存。</FieldDescription>
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={unavailable || Boolean(invalid) || !target.trim()}
            onClick={() => void test()}
          >
            {testing && <LoaderCircle className="size-3.5 animate-spin" />}
            {testing ? '测试中…' : '测试连接'}
          </Button>
          <Button
            size="sm"
            disabled={unavailable || busy || Boolean(actionPending) || Boolean(invalid) || !changed}
            onClick={() => void save()}
          >
            {pending && <LoaderCircle className="size-3.5 animate-spin" />}
            {pending ? '正在应用…' : '保存并应用'}
          </Button>
        </div>
        <FieldError>{error || (draft.url && invalid)}</FieldError>
      </div>
      <FieldDescription className="mt-5">
        保存后重新连接当前会话。请等待所有会话的任务结束后再修改代理。
      </FieldDescription>
    </>
  )
}
