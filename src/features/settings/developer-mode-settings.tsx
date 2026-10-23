import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { isDesktop, openDeveloperConsole } from '@/lib/desktop'

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
    <div className="border-b py-5">
      <div className="flex items-center justify-between gap-5">
        <div className="min-w-0">
          <h3 id="developer-mode-label" className="text-sm font-normal">
            开发者模式
          </h3>
          <p
            id="developer-mode-description"
            className="mt-1.5 text-xs leading-5 text-muted-foreground"
          >
            {supported
              ? '打开独立后台终端，查看会话连接、设置切换和报错。'
              : '独立后台终端需在 Windows 桌面应用中使用。'}
          </p>
        </div>
        <Switch
          aria-labelledby="developer-mode-label"
          aria-describedby="developer-mode-description"
          checked={enabled}
          disabled={!supported || pending}
          onCheckedChange={(checked) => void change(checked)}
        />
      </div>
      {enabled && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-xs leading-5 text-muted-foreground">
            关闭终端不会退出应用；重启后保持开启。
          </p>
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
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
