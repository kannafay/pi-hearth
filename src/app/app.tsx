import { useTheme } from '@/app/use-theme'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspaceShell } from '@/features/workspace/workspace-shell'
import { installScrollbars } from '@/lib/scrollbars'

export function App() {
  useTheme()
  useEffect(() => installScrollbars(document.body), [])
  return (
    <TooltipProvider delay={300}>
      <WorkspaceShell />
    </TooltipProvider>
  )
}
import { useEffect } from 'react'
