import { MessageSquare } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import { ConnectionNotice } from './connection-notice'
import { useConversationStore } from './store'

export function ConversationWelcome() {
  const { projectPath } = useWorkspaceStore()
  const { status, sessionFile, error } = useConversationStore()
  const connecting = status === 'connecting'
  const desktop = isDesktop()
  const projectName = projectPath?.split(/[\\/]/).filter(Boolean).at(-1)

  if (connecting && sessionFile) {
    return (
      <div className="mx-auto w-full max-w-209" aria-label="正在载入会话">
        <ConnectionNotice className="rounded-xl border border-border/60 bg-muted/25 px-3 py-2" />
        <p className="mt-3 px-1 text-xs leading-5 text-muted-foreground/75">
          正在准备聊天记录，你可以先输入消息。
        </p>
        <div aria-hidden className="mt-8 space-y-8 motion-safe:animate-pulse">
          <div className="ml-auto h-10 w-40 max-w-[60%] rounded-xl bg-muted/60" />
          <div className="space-y-3">
            <div className="mb-5 h-3 w-16 rounded bg-muted/50" />
            <div className="h-3 w-3/4 rounded bg-muted/50" />
            <div className="h-3 w-5/6 rounded bg-muted/50" />
            <div className="h-3 w-1/2 rounded bg-muted/50" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-55 items-center justify-center">
      <div className="w-full max-w-100 py-8">
        <div className="mb-5 flex size-11 items-center justify-center rounded-2xl bg-muted/70">
          <MessageSquare aria-hidden className="size-5 stroke-[1.5]" />
        </div>
        <p className="mb-2 truncate text-xs text-muted-foreground">{projectName ?? '普通聊天'}</p>
        <h1 className="text-xl font-medium tracking-tight">
          {error ? '连接未完成' : (projectName ?? '开始一段新聊天')}
        </h1>
        <div className="mt-3 text-sm leading-6 text-muted-foreground">
          {error
            ? '请重试连接，也可以从侧栏打开其他会话。'
            : projectPath
              ? '围绕当前项目提问，或添加文件开始处理任务。'
              : '写下你的问题，或添加图片与文件。'}
        </div>
        <ConnectionNotice className="mt-5" />
        {!desktop && (
          <p className="mt-4 text-xs text-muted-foreground">浏览器预览 · 对话需在桌面应用中使用</p>
        )}
      </div>
    </div>
  )
}
