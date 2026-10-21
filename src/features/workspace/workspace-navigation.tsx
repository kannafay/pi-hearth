import { useId, useState } from 'react'
import { Tabs } from '@base-ui/react/tabs'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  SquarePen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import type { ProjectInfo, SessionInfo } from '@/lib/generated/pi'

const samePath = (a: string, b: string | null) =>
  a.replaceAll('\\', '/').toLowerCase() === b?.replaceAll('\\', '/').toLowerCase()

function sessionTime(modified: number) {
  const minutes = Math.max(0, (Date.now() - modified) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${Math.floor(minutes)}分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`
  return `${Math.floor(minutes / 1440)}天前`
}

export function WorkspaceNavigation({
  desktop,
  onAdd,
  onCreate,
  onSettings,
  onInstructions,
}: {
  desktop: boolean
  onAdd: () => void
  onCreate: () => void
  onSettings: () => void
  onInstructions: (project: ProjectInfo) => void
}) {
  const workspace = useWorkspaceStore()
  const { status, sessionFile } = useConversationStore()
  const [filter, setFilter] = useState('all')
  const tooltipId = useId()
  const busy = ['running', 'stopping'].includes(status)
  const rows = (sessions: SessionInfo[]) =>
    sessions.map((session) => (
      <Tooltip key={session.path}>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              className={`h-8 w-full min-w-0 justify-start gap-2 rounded-md px-2 text-[13px] font-normal ${samePath(session.path, sessionFile) ? 'bg-sidebar-accent text-foreground' : 'text-sidebar-foreground/80'}`}
              aria-current={samePath(session.path, sessionFile) ? 'page' : undefined}
              aria-describedby={`${tooltipId}-session-${encodeURIComponent(session.path)}`}
              disabled={!desktop || busy}
              onClick={() => void workspace.openSession(session)}
            />
          }
        >
          <span className="min-w-0 flex-1 truncate text-left">{session.title}</span>
        </TooltipTrigger>
        <TooltipContent
          variant="card"
          showArrow={false}
          role="tooltip"
          id={`${tooltipId}-session-${encodeURIComponent(session.path)}`}
          side="right"
          align="start"
          sideOffset={8}
          className="block w-80 max-w-[min(24rem,var(--available-width))] space-y-1.5 px-3 py-2.5"
        >
          <div className="flex items-start justify-between gap-4">
            <span className="min-w-0 font-medium wrap-anywhere">{session.title}</span>
            <span className="shrink-0 text-[11px] opacity-70">{sessionTime(session.modified)}</span>
          </div>
          <div className="flex items-start gap-2 opacity-75">
            <Folder className="mt-0.5 size-3.5 shrink-0 stroke-[1.5]" />
            <span className="min-w-0 wrap-anywhere">{session.cwd}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    ))
  const general = workspace.sessions.filter((session) =>
    samePath(session.cwd, workspace.generalCwd),
  )
  const ungrouped = workspace.sessions.filter(
    (session) =>
      !samePath(session.cwd, workspace.generalCwd) &&
      !workspace.projects.some((project) => samePath(project.path, session.cwd)),
  )

  return (
    <nav aria-label="项目与会话" className="workspace-navigation flex h-full min-h-0 flex-col pb-2">
      <div className="flex h-11 shrink-0 items-center px-2 pt-px">
        <Button
          variant="ghost"
          className="h-8 w-full justify-start gap-2.5 px-2 text-[13px]"
          disabled={!desktop || busy}
          onClick={() => void workspace.newConversation(null)}
        >
          <SquarePen className="size-4 stroke-[1.6]" />
          新建聊天
        </Button>
      </div>
      <Tabs.Root
        value={filter}
        onValueChange={(value) => setFilter(String(value))}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="mx-2 mt-3 mb-5 flex h-8 items-center">
          <Tabs.List
            aria-label="会话分类"
            className="sidebar-tabs relative isolate grid h-8 min-w-0 flex-1 grid-cols-3 items-center rounded-lg p-0.5"
          >
            {(
              [
                ['all', '全部', LayoutGrid],
                ['projects', '项目', Folder],
                ['chats', '聊天', MessageSquare],
              ] as const
            ).map(([value, label, Icon]) => (
              <Tabs.Tab
                key={value}
                value={value}
                className="relative z-10 flex h-7 items-center justify-center gap-1.5 rounded-md text-xs whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-foreground"
              >
                <Icon aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.5]" />
                {label}
              </Tabs.Tab>
            ))}
            <Tabs.Indicator className="sidebar-tab-indicator absolute top-(--active-tab-top) left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) rounded-md bg-sidebar-accent shadow-xs transition-[translate,width] duration-200 ease-out" />
          </Tabs.List>
        </div>
        <Tabs.Panel value={filter} className="flex min-h-0 flex-1 flex-col">
          <ScrollArea
            className="min-h-0 flex-1"
            viewportClassName="h-full overflow-x-hidden overflow-y-auto px-2"
          >
            {filter !== 'chats' && (
              <section aria-label="项目" className="mb-6">
                <div className="mb-1 flex h-7 items-center justify-between px-2">
                  <h2 className="text-xs font-normal text-muted-foreground">项目</h2>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button aria-label="项目操作" variant="ghost" size="icon-xs" />}
                    >
                      <Plus className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem disabled={!desktop || busy} onClick={onAdd}>
                        <FolderOpen />
                        添加项目
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!desktop || busy} onClick={onCreate}>
                        <FolderPlus />
                        创建项目
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!desktop || workspace.loading}
                        onClick={() => void workspace.refresh()}
                      >
                        <RefreshCw />
                        刷新会话
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-col gap-1">
                  {workspace.projects.map((project) => (
                    <Collapsible
                      key={`${project.path}-${samePath(project.path, workspace.projectPath)}`}
                      defaultOpen={samePath(project.path, workspace.projectPath)}
                      className="flex flex-col"
                    >
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <div className="group/project flex h-8 items-center rounded-md hover:bg-sidebar-accent focus-within:bg-sidebar-accent" />
                          }
                        >
                          <CollapsibleTrigger
                            render={
                              <button
                                type="button"
                                className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-1 pl-1 text-left text-[13px] font-normal outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                aria-describedby={`${tooltipId}-project-${encodeURIComponent(project.path)}`}
                              />
                            }
                          >
                            <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform duration-160 ease-out in-data-panel-open:rotate-90" />
                            <Folder className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
                            <span className="truncate">{project.name}</span>
                          </CollapsibleTrigger>
                          <div className="mr-1 flex shrink-0 opacity-0 transition-opacity group-focus-within/project:opacity-100 group-hover/project:opacity-100">
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`在 ${project.name} 中新建会话`}
                              disabled={!desktop || busy}
                              onClick={() => void workspace.newConversation(project.path)}
                            >
                              <Plus className="size-3.5" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    aria-label={`${project.name} 项目菜单`}
                                  />
                                }
                              >
                                <MoreHorizontal className="size-3.5" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuItem
                                  disabled={busy}
                                  onClick={() => onInstructions(project)}
                                >
                                  项目指令
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!desktop || busy}
                                  onClick={() => void workspace.newConversation(project.path)}
                                >
                                  新建会话
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent
                          variant="card"
                          showArrow={false}
                          role="tooltip"
                          id={`${tooltipId}-project-${encodeURIComponent(project.path)}`}
                          side="right"
                          align="start"
                          sideOffset={8}
                          className="block max-w-sm space-y-1.5 px-3 py-2.5"
                        >
                          <div className="font-medium">{project.name}</div>
                          <div className="flex items-start gap-2 opacity-75">
                            <Folder className="mt-0.5 size-3.5 shrink-0 stroke-[1.5]" />
                            <span className="min-w-0 wrap-anywhere">{project.path}</span>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      <CollapsibleContent className="sidebar-project-sessions">
                        <div className="ml-3 flex flex-col gap-1 border-l border-border/60 pt-1 pl-1.5">
                          {rows(
                            workspace.sessions.filter((session) =>
                              samePath(session.cwd, project.path),
                            ),
                          )}
                          {!workspace.sessions.some((session) =>
                            samePath(session.cwd, project.path),
                          ) && <p className="px-2 py-2 text-xs text-muted-foreground">暂无会话</p>}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
                {!workspace.projects.length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 ml-1 text-xs text-muted-foreground"
                    disabled={!desktop || busy}
                    onClick={onAdd}
                  >
                    <Plus />
                    添加项目
                  </Button>
                )}
              </section>
            )}
            {filter !== 'projects' && (
              <section aria-label="聊天">
                <div className="mb-1 flex h-7 items-center justify-between px-2">
                  <h2 className="text-xs font-normal text-muted-foreground">聊天</h2>
                  <Button
                    aria-label="新建普通聊天"
                    size="icon-xs"
                    variant="ghost"
                    disabled={!desktop || busy}
                    onClick={() => void workspace.newConversation(null)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  {rows(general)}
                  {rows(ungrouped)}
                </div>
                {!general.length && !ungrouped.length && (
                  <p className="px-2 py-2 text-xs text-muted-foreground">直接开始一段新聊天</p>
                )}
              </section>
            )}
          </ScrollArea>
        </Tabs.Panel>
      </Tabs.Root>
      <Button
        variant="ghost"
        className="mx-2 mt-3 h-8 justify-start gap-2.5 px-2 text-[13px] text-muted-foreground"
        onClick={onSettings}
      >
        <Settings className="size-4 stroke-[1.6]" />
        设置
      </Button>
    </nav>
  )
}
