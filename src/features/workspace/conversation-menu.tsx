import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Archive, FolderOpen, MoreHorizontal, Pin, PinOff, SquarePen } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { ApplicationIcon } from '@/components/application-icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isSessionBusy, useConversationStore } from '@/features/conversation/store'
import { isDesktop, openDirectoryWith, type DirectoryApplication } from '@/lib/desktop'
import type { SessionInfo } from '@/lib/generated/pi'
import { sessionPreference } from '@/lib/session-preferences'
import { toast } from '@/lib/toast'

const applications: { value: DirectoryApplication; label: string }[] = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'explorer', label: '资源管理器' },
  { value: 'terminal', label: 'Windows 终端' },
]

export function ConversationMenu({
  session,
  onRename,
}: {
  session: SessionInfo | undefined
  onRename: (session: SessionInfo) => void
}) {
  const workspace = useWorkspaceStore(
    useShallow((state) => ({
      projectPath: state.projectPath,
      generalCwd: state.generalCwd,
      preferences: state.sessionPreferences,
      pending: state.sessionActionPending,
      togglePinned: state.toggleSessionPinned,
      archive: state.setSessionArchived,
    })),
  )
  const busy = useConversationStore((state) => Boolean(session && isSessionBusy(session, state)))
  const [opening, setOpening] = useState(false)
  const directory = session?.cwd ?? workspace.projectPath ?? workspace.generalCwd
  const pinned = session ? sessionPreference(workspace.preferences, session.path).pinned : false
  const disabled = !isDesktop() || Boolean(workspace.pending)

  async function open(application: DirectoryApplication) {
    if (!directory || opening) return
    setOpening(true)
    try {
      await openDirectoryWith(directory, application)
    } catch (reason) {
      toast.error(reason)
    } finally {
      setOpening(false)
    }
  }

  return (
    <DropdownMenu key={session?.path ?? directory ?? 'new'}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="会话更多操作"
            disabled={disabled || opening}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem disabled={!session || busy} onClick={() => session && onRename(session)}>
          <SquarePen />
          重命名
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!session}
          onClick={() => session && void workspace.togglePinned(session)}
        >
          {pinned ? <PinOff /> : <Pin />}
          {pinned ? '取消置顶' : '置顶'}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!directory}>
            <FolderOpen />
            打开方式
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-40">
            {applications.map(({ value, label }) => (
              <DropdownMenuItem key={value} onClick={() => void open(value)}>
                <ApplicationIcon application={value} />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          disabled={!session || busy}
          onClick={() => session && void workspace.archive(session, true)}
        >
          <Archive />
          归档
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
