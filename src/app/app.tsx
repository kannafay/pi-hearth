import { useTheme } from '@/app/use-theme'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspaceShell } from '@/features/workspace/workspace-shell'
import { installScrollbars } from '@/lib/scrollbars'
import { isDesktop } from '@/lib/desktop'
import { useShallow } from 'zustand/react/shallow'

export function App() {
  useTheme()
  const { settingsReady, settingsLoading, error, hydrateSettings } = useWorkspaceStore(
    useShallow((state) => ({
      settingsReady: state.settingsReady,
      settingsLoading: state.settingsLoading,
      error: state.error,
      hydrateSettings: state.hydrateSettings,
    })),
  )
  const desktop = isDesktop()
  useEffect(() => installScrollbars(document.body), [])
  useEffect(() => {
    if (desktop) void hydrateSettings()
  }, [desktop, hydrateSettings])
  if (desktop && !settingsReady)
    return (
      <div className="workspace-shell flex h-dvh items-center justify-center text-sm text-muted-foreground">
        {error ? (
          <div className="flex max-w-lg flex-col items-center gap-3 px-6">
            <p role="alert">{error}</p>
            <Button
              variant="outline"
              disabled={settingsLoading}
              onClick={() => void hydrateSettings()}
            >
              重试
            </Button>
          </div>
        ) : (
          <p role="status">正在打开工作台…</p>
        )}
      </div>
    )
  return (
    <TooltipProvider delay={300}>
      <WorkspaceShell />
    </TooltipProvider>
  )
}
import { useEffect } from 'react'
