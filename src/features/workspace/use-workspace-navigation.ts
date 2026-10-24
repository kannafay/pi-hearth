import { useState } from 'react'
import { useDialogPresence } from '@/components/use-dialog-presence'
import type { ProjectInfo, SessionInfo } from '@/lib/generated/pi'
import { useNavigationTabs } from './use-navigation-tabs'

// Keep navigation state outside its docked and floating presentations.
export function useWorkspaceNavigation() {
  const tabs = useNavigationTabs()
  const [deleteProject, setDeleteProject] = useState<ProjectInfo | null>(null)
  const [renameSession, setRenameSession] = useState<SessionInfo | null>(null)
  const renamePresence = useDialogPresence(renameSession)
  return { tabs, deleteProject, setDeleteProject, renameSession, setRenameSession, renamePresence }
}
