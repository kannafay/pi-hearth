import { useTheme } from '@/app/use-theme'
import { useWorkspaceStore } from '@/app/store'
import { StartupScreen } from './startup-screen'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toast'
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
      <StartupScreen
        error={error}
        loading={settingsLoading}
        onRetry={() => void hydrateSettings()}
      />
    )
  return (
    <TooltipProvider delay={300}>
      <Toaster />
      <WorkspaceShell />
    </TooltipProvider>
  )
}
import { useEffect } from 'react'
