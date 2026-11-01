import { useShallow } from 'zustand/react/shallow'
import { Archive, MoreHorizontal, Pin, PinOff, SquarePen } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isSessionBusy, useConversationStore } from '@/features/conversation/store'
import { isDesktop } from '@/lib/desktop'
import type { SessionInfo } from '@/lib/generated/pi'
import { sessionPreference } from '@/lib/session-preferences'

export function ConversationMenu({
  session,
  onRename,
}: {
  session: SessionInfo | undefined
  onRename: (session: SessionInfo) => void
}) {
  const workspace = useWorkspaceStore(
    useShallow((state) => ({
      preferences: state.sessionPreferences,
      pending: state.sessionActionPending,
      togglePinned: state.toggleSessionPinned,
      archive: state.setSessionArchived,
    })),
  )
  const busy = useConversationStore((state) => Boolean(session && isSessionBusy(session, state)))
  const pinned = session ? sessionPreference(workspace.preferences, session.path).pinned : false
  const disabled = !session || !isDesktop() || Boolean(workspace.pending)

  return (
    <DropdownMenu key={session?.path ?? 'new'}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="会话更多操作"
            disabled={disabled}
            className="shrink-0 text-muted-foreground hover:text-foreground aria-expanded:text-foreground"
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
