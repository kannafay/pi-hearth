import { useShallow } from 'zustand/react/shallow'
import { RotateCcw } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { isDesktop } from '@/lib/desktop'
import { useConversationStore } from './store'

export function ConnectionNotice({ className = '' }: { className?: string }) {
  const { status, sessionFile, hasMessages, error, connectionTarget, connect } =
    useConversationStore(
      useShallow((state) => ({
        status: state.status,
        sessionFile: state.sessionFile,
        hasMessages: state.messages.length > 0,
        error: state.error,
        connectionTarget: state.connectionTarget,
        connect: state.connect,
      })),
    )
  const projectPath = useWorkspaceStore((state) => state.projectPath)
  if (
    !isDesktop() ||
    status !== 'disconnected' ||
    (!error && !connectionTarget && !sessionFile && !hasMessages)
  )
    return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex min-h-7 items-center gap-2 text-xs text-muted-foreground ${className}`}
    >
      <span className="min-w-0 flex-1">{error ? '连接未完成' : '助手已断开'}</span>
      <Button
        variant="ghost"
        size="xs"
        className="h-6 shrink-0 px-2 font-normal text-muted-foreground"
        aria-label="重新连接"
        onClick={() => void connect(projectPath, sessionFile)}
      >
        <RotateCcw className="size-3" />
        重新连接
      </Button>
    </div>
  )
}
