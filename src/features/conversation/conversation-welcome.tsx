import { useShallow } from 'zustand/react/shallow'
import { CircleAlert, FolderOpen } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useConversationStore } from './store'

export function ConversationWelcome() {
  const { projectPath } = useWorkspaceStore()
  const { status, sessionFile, error } = useConversationStore(
    useShallow((state) => ({
      status: state.status,
      sessionFile: state.sessionFile,
      error: state.error,
    })),
  )
  const connecting = status === 'connecting'
  const desktop = isDesktop()
  const projectName = projectPath?.split(/[\\/]/).filter(Boolean).at(-1)

  if (connecting && sessionFile) {
    return (
      <div className="mx-auto w-full max-w-209" aria-label="正在载入会话" aria-busy="true">
        <div aria-hidden className="space-y-8 motion-safe:animate-pulse">
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
    <div className="conversation-welcome flex h-full min-h-60 items-center justify-center px-2">
      <div className="w-full max-w-112 py-8 text-center">
        <div className="mb-6 flex justify-center" aria-hidden>
          {error ? (
            <CircleAlert className="size-9 stroke-[1.3] text-muted-foreground" />
          ) : (
            <img src="/pi.svg" alt="" draggable={false} className="size-9" />
          )}
        </div>
        {projectName && error && (
          <p className="mb-3 flex min-w-0 items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <FolderOpen aria-hidden className="size-3.5 shrink-0" />
            <Tooltip>
              <TooltipTrigger render={<span className="truncate" />}>{projectName}</TooltipTrigger>
              <TooltipContent showArrow={false} className="max-w-96 wrap-anywhere">
                {projectPath}
              </TooltipContent>
            </Tooltip>
          </p>
        )}
        <h1 className="text-2xl leading-9 font-medium tracking-tight">
          {error ? '连接未完成' : '开始一段新对话'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error
            ? '请重试连接，也可以从侧栏打开其他会话。'
            : projectPath
              ? '围绕当前项目提问，或添加文件一起处理。'
              : '从一个问题开始，也可以选择项目或添加文件。'}
        </p>
        {!desktop && (
          <p className="mt-4 text-xs text-muted-foreground">浏览器预览 · 对话需在桌面应用中使用</p>
        )}
      </div>
    </div>
  )
}
