import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { isDesktop, openDeveloperConsole } from '@/lib/desktop'
import { SettingsRow } from './settings-row'
import { FieldDescription, FieldError } from '@/components/ui/field'

export function DeveloperModeSettings() {
  const { enabled, pending, setDeveloperMode } = useWorkspaceStore(
    useShallow((state) => ({
      enabled: state.developerMode,
      pending: state.developerModePending,
      setDeveloperMode: state.setDeveloperMode,
    })),
  )
  const [error, setError] = useState('')
  const supported = isDesktop() && /Windows/i.test(navigator.userAgent)

  async function change(enabled: boolean) {
    setError('')
    try {
      await setDeveloperMode(enabled)
    } catch (reason) {
      setError(String(reason))
    }
  }

  async function open() {
    setError('')
    try {
      await openDeveloperConsole()
    } catch (reason) {
      setError(String(reason))
    }
  }

  return (
    <SettingsRow
      title="开发者模式"
      titleId="developer-mode-label"
      descriptionId="developer-mode-description"
      htmlFor="developer-mode"
      description={
        supported
          ? '打开独立后台终端，查看会话连接、设置切换和报错。'
          : '独立后台终端需在 Windows 桌面应用中使用。'
      }
      control={
        <Switch
          id="developer-mode"
          aria-labelledby="developer-mode-label"
          aria-describedby="developer-mode-description"
          checked={enabled}
          disabled={!supported || pending}
          onCheckedChange={(checked) => void change(checked)}
        />
      }
    >
      {enabled && (
        <div className="flex items-center justify-between gap-4">
          <FieldDescription>关闭终端不会退出应用；重启后保持开启。</FieldDescription>
          <Button
            variant="outline"
            size="sm"
            disabled={!supported || pending}
            onClick={() => void open()}
          >
            打开终端
          </Button>
        </div>
      )}
      <FieldError>{error}</FieldError>
    </SettingsRow>
  )
}
