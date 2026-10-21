import { useEffect, useState } from 'react'
import { LoaderCircle, MessageSquare, RotateCcw } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { isDesktop } from '@/lib/desktop'
import { useConversationStore } from './store'

export function ConversationWelcome() {
  const { projectPath } = useWorkspaceStore()
  const { status, sessionFile, error, connect, disconnect, connectionStartedAt } =
    useConversationStore()
  const [slowFor, setSlowFor] = useState<number | null>(null)
  const connecting = status === 'connecting'
  const slow = connecting && connectionStartedAt !== null && slowFor === connectionStartedAt
  const desktop = isDesktop()
  const projectName = projectPath?.split(/[\\/]/).filter(Boolean).at(-1)

  useEffect(() => {
    if (!connecting || !connectionStartedAt) return
    const timer = setTimeout(
      () => setSlowFor(connectionStartedAt),
      Math.max(0, 8000 - (Date.now() - connectionStartedAt)),
    )
    return () => clearTimeout(timer)
  }, [connecting, connectionStartedAt])

  return (
    <div className="flex h-full min-h-55 items-center justify-center">
      <div className="w-full max-w-100 py-8">
        <div className="mb-5 flex size-11 items-center justify-center rounded-2xl bg-muted/70">
          {connecting ? (
            <LoaderCircle
              aria-hidden
              className="size-5 animate-spin stroke-[1.5] text-muted-foreground"
            />
          ) : (
            <MessageSquare aria-hidden className="size-5 stroke-[1.5]" />
          )}
        </div>
        <p className="mb-2 truncate text-xs text-muted-foreground">{projectName ?? '普通聊天'}</p>
        <h1 className="text-xl font-medium tracking-tight">
          {connecting
            ? sessionFile
              ? '正在打开会话'
              : '正在连接助手'
            : error
              ? '连接未完成'
              : (projectName ?? '开始一段新聊天')}
        </h1>
        <div
          role="status"
          aria-live="polite"
          className="mt-3 text-sm leading-6 text-muted-foreground"
        >
          {connecting ? (
            <>
              <p>
                {slow
                  ? '连接时间比平时稍长，仍在等待本地助手。'
                  : sessionFile
                    ? '正在载入聊天记录并连接本地助手。'
                    : '正在启动本地助手并载入模型。'}
              </p>
              <p className="mt-1">你可以先输入消息，也可以随时从侧栏切换会话。</p>
            </>
          ) : error ? (
            '请重试连接，也可以从侧栏打开其他会话。'
          ) : projectPath ? (
            '围绕当前项目提问，或添加文件开始处理任务。'
          ) : (
            '写下你的问题，或添加图片与文件。'
          )}
        </div>
        {desktop && connecting ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-5 -ml-2 text-muted-foreground"
            onClick={() => void disconnect()}
          >
            取消连接
          </Button>
        ) : desktop && status === 'disconnected' ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-5"
            onClick={() => void connect(projectPath, sessionFile)}
          >
            <RotateCcw />
            重新连接
          </Button>
        ) : null}
        {!desktop && (
          <p className="mt-4 text-xs text-muted-foreground">浏览器预览 · 对话需在桌面应用中使用</p>
        )}
      </div>
    </div>
  )
}
