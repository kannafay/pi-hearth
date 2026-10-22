import { useShallow } from 'zustand/react/shallow'
import { useEffect, useState } from 'react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { isDesktop } from '@/lib/desktop'
import { useConversationStore } from './store'

export function ConnectionNotice({ className = '' }: { className?: string }) {
  const { status, sessionFile, hasMessages, error, connectionStartedAt, connect, disconnect } =
    useConversationStore(
      useShallow((state) => ({
        status: state.status,
        sessionFile: state.sessionFile,
        hasMessages: state.messages.length > 0,
        error: state.error,
        connectionStartedAt: state.connectionStartedAt,
        connect: state.connect,
        disconnect: state.disconnect,
      })),
    )
  const projectPath = useWorkspaceStore((state) => state.projectPath)
  const [slowFor, setSlowFor] = useState<number | null>(null)
  const connecting = status === 'connecting'
  const slow = connecting && connectionStartedAt !== null && slowFor === connectionStartedAt

  useEffect(() => {
    if (!connecting || connectionStartedAt === null) return
    const timer = setTimeout(
      () => setSlowFor(connectionStartedAt),
      Math.max(0, 8000 - (Date.now() - connectionStartedAt)),
    )
    return () => clearTimeout(timer)
  }, [connecting, connectionStartedAt])

  if (!connecting && status !== 'disconnected') return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex min-h-7 items-center gap-2 text-xs text-muted-foreground ${className}`}
    >
      {connecting && (
        <LoaderCircle
          aria-hidden
          className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
        />
      )}
      <span className="min-w-0 flex-1">
        {connecting
          ? slow
            ? '连接较慢，仍在等待本地助手…'
            : sessionFile && !hasMessages
              ? '正在载入会话…'
              : '正在连接助手…'
          : error
            ? '连接未完成'
            : '助手尚未连接'}
      </span>
      {isDesktop() && (
        <Button
          variant="ghost"
          size="xs"
          className="h-6 shrink-0 px-2 font-normal text-muted-foreground"
          aria-label={connecting ? '取消连接' : '重新连接'}
          onClick={() => void (connecting ? disconnect() : connect(projectPath, sessionFile))}
        >
          {!connecting && <RotateCcw className="size-3" />}
          {connecting ? '取消' : '重新连接'}
        </Button>
      )}
    </div>
  )
}
