import { useShallow } from 'zustand/react/shallow'
import { useId } from 'react'
import { Tabs } from '@base-ui/react/tabs'
import {
  Archive,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Pin,
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import type { ProjectInfo, SessionInfo } from '@/lib/generated/pi'
import { sessionKey, sessionPreference, visibleSessions } from '@/lib/session-preferences'
import { useNavigationTabs } from './use-navigation-tabs'

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
  onCreate,
  onSettings,
  onInstructions,
}: {
  desktop: boolean
  onCreate: () => void
  onSettings: () => void
  onInstructions: (project: ProjectInfo) => void
}) {
  const workspace = useWorkspaceStore()
  const { status, sessionFile } = useConversationStore(
    useShallow((state) => ({ status: state.status, sessionFile: state.sessionFile })),
  )
  const { filter, contentFilter, leaving, viewportRef, rememberScroll, selectFilter } =
    useNavigationTabs()
  const tooltipId = useId()
  const busy = ['running', 'stopping'].includes(status)
  const projectExpanded = (path: string) =>
    workspace.expandedProjects[sessionKey(path)!] ?? samePath(path, workspace.projectPath)
  const sessions = visibleSessions(workspace.sessions, workspace.sessionPreferences)
  const rows = (sessions: SessionInfo[]) =>
    sessions.map((session) => {
      const selected = samePath(session.path, sessionFile)
      const pinned = sessionPreference(workspace.sessionPreferences, session.path).pinned
      return (
        <div
          key={session.path}
          data-selected={selected}
          data-responding={busy && selected ? true : undefined}
          className="sidebar-session-row group/session flex h-7.5 min-w-0 items-center rounded-md text-sidebar-foreground/80"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  className="sidebar-session-link h-full min-w-0 flex-1 justify-start gap-2 rounded-md px-2 text-[13px] font-normal text-inherit"
                  aria-current={selected ? 'page' : undefined}
                  aria-describedby={`${tooltipId}-session-${encodeURIComponent(session.path)}`}
                  disabled={!desktop || busy}
                  onClick={() => void workspace.openSession(session)}
                />
              }
            >
              <span className="sidebar-row-title min-w-0 flex-1 truncate text-left">
                {session.title}
              </span>
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
                <span className="shrink-0 text-[11px] opacity-70">
                  {sessionTime(session.modified)}
                </span>
              </div>
              <div className="flex items-start gap-2 opacity-75">
                <Folder className="mt-0.5 size-3.5 shrink-0 stroke-[1.5]" />
                <span className="min-w-0 wrap-anywhere">{session.cwd}</span>
              </div>
            </TooltipContent>
          </Tooltip>
          {busy && selected && (
            <span
              role="status"
              aria-label="正在回复"
              className="sidebar-session-progress pointer-events-none absolute inset-y-0 right-0 z-1 flex w-8 items-center justify-center text-muted-foreground"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-3.5 animate-spin stroke-[1.5] motion-reduce:animate-none"
              />
              <span className="sr-only">正在回复</span>
            </span>
          )}
          <div
            className="sidebar-session-actions flex items-center gap-0.5 px-1"
            role="group"
            aria-label="会话操作"
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={`sidebar-session-action size-6 ${pinned ? 'text-sidebar-foreground' : 'text-muted-foreground/60 hover:text-foreground'}`}
                    aria-label={`${pinned ? '取消置顶' : '置顶'} ${session.title}`}
                    aria-pressed={pinned}
                    disabled={!desktop || Boolean(workspace.sessionActionPending)}
                    onClick={() => void workspace.toggleSessionPinned(session)}
                  />
                }
              >
                <Pin className={`size-3.5 stroke-[1.5] ${pinned ? 'fill-current' : ''}`} />
              </TooltipTrigger>
              <TooltipContent showArrow={false}>{pinned ? '取消置顶' : '置顶'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="sidebar-session-action size-6 text-muted-foreground/60 hover:text-foreground"
                    aria-label={`归档 ${session.title}`}
                    disabled={
                      !desktop || Boolean(workspace.sessionActionPending) || (busy && selected)
                    }
                    onClick={() => void workspace.setSessionArchived(session, true)}
                  />
                }
              >
                <Archive className="size-3.5 stroke-[1.5]" />
              </TooltipTrigger>
              <TooltipContent showArrow={false}>归档</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )
    })
  const chats = sessions.filter(
    (session) =>
      samePath(session.cwd, workspace.generalCwd) ||
      !workspace.projects.some((project) => samePath(project.path, session.cwd)),
  )

  return (
    <nav aria-label="项目与会话" className="workspace-navigation flex h-full min-h-0 flex-col pb-2">
      <div className="box-content flex h-11 shrink-0 items-end border-t border-transparent px-3">
        <Button
          variant="ghost"
          className="h-8 w-full justify-start gap-2.5 px-2 text-[13px]"
          disabled={!desktop || busy}
          onClick={() => void workspace.newConversation(null)}
        >
          <SquarePen className="size-4 stroke-[1.6]" />
          新对话
        </Button>
      </div>
      <Tabs.Root
        value={filter}
        onValueChange={(value, { activationDirection }) =>
          selectFilter(String(value), activationDirection)
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="mx-3 mt-3 mb-5 flex h-8 items-center">
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
            <Tabs.Indicator className="sidebar-tab-indicator absolute top-(--active-tab-top) left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) rounded-md bg-sidebar-accent shadow-xs" />
          </Tabs.List>
        </div>
        <Tabs.Panel value={filter} aria-busy={leaving} className="flex min-h-0 flex-1 flex-col">
          <ScrollArea
            ref={viewportRef}
            onScroll={rememberScroll}
            inert={leaving}
            data-sidebar-tab-content={contentFilter}
            className="min-h-0 flex-1 overflow-hidden"
            viewportClassName="h-full overflow-x-hidden overflow-y-auto px-3"
          >
            {contentFilter !== 'chats' && (
              <section aria-label="项目" className="mb-6">
                <div className="mb-1 flex h-7 items-center justify-between px-2">
                  <h2 className="text-xs font-normal text-muted-foreground">项目</h2>
                  <Button
                    aria-label="创建项目"
                    variant="ghost"
                    size="icon-xs"
                    disabled={!desktop || busy}
                    onClick={onCreate}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  {workspace.projects.map((project) => (
                    <Collapsible
                      key={project.path}
                      open={projectExpanded(project.path)}
                      onOpenChange={(open) => workspace.setProjectExpanded(project.path, open)}
                      className="flex flex-col"
                    >
                      <div className="sidebar-project-row flex h-7.5 min-w-0 items-center rounded-md">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <CollapsibleTrigger
                                render={
                                  <button
                                    type="button"
                                    className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] font-normal outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    aria-describedby={`${tooltipId}-project-${encodeURIComponent(project.path)}`}
                                  />
                                }
                              />
                            }
                          >
                            {projectExpanded(project.path) ? (
                              <FolderOpen className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
                            ) : (
                              <Folder className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
                            )}
                            <span className="sidebar-row-title min-w-0 flex-1 truncate">
                              {project.name}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            variant="card"
                            showArrow={false}
                            role="tooltip"
                            id={`${tooltipId}-project-${encodeURIComponent(project.path)}`}
                            side="right"
                            align="start"
                            sideOffset={8}
                            className="block w-max max-w-[min(20rem,var(--available-width))] space-y-1.5 px-3 py-2.5"
                          >
                            <div className="font-medium wrap-anywhere">{project.name}</div>
                            <div className="flex items-start gap-2 opacity-75">
                              <Folder className="mt-0.5 size-3.5 shrink-0 stroke-[1.5]" />
                              <span className="min-w-0 break-all">{project.path}</span>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                        <div className="sidebar-project-actions flex items-center gap-0.5 px-1">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="sidebar-project-action size-6 text-muted-foreground/60 hover:text-foreground"
                            aria-label={`在 ${project.name} 中新建对话`}
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
                                  className="sidebar-project-action size-6 text-muted-foreground/60 hover:text-foreground"
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
                                新对话
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <CollapsibleContent className="sidebar-project-sessions">
                        <div className="flex flex-col gap-1 pt-1">
                          {rows(sessions.filter((session) => samePath(session.cwd, project.path)))}
                          {!sessions.some((session) => samePath(session.cwd, project.path)) && (
                            <p className="px-2 py-2 text-xs text-muted-foreground">暂无会话</p>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
                {!workspace.projects.length && (
                  <Button
                    variant="ghost"
                    className="h-8 w-full justify-start gap-2 rounded-md px-2 text-[13px] font-normal text-muted-foreground"
                    disabled={!desktop || busy}
                    onClick={onCreate}
                  >
                    <FolderPlus className="size-4 stroke-[1.5]" />
                    添加项目
                  </Button>
                )}
              </section>
            )}
            {contentFilter !== 'projects' && (
              <section aria-label="聊天">
                <div className="mb-1 flex h-7 items-center justify-between px-2">
                  <h2 className="text-xs font-normal text-muted-foreground">聊天</h2>
                  <Button
                    aria-label="新建普通对话"
                    size="icon-xs"
                    variant="ghost"
                    disabled={!desktop || busy}
                    onClick={() => void workspace.newConversation(null)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <div className="flex flex-col gap-1">{rows(chats)}</div>
                {!chats.length && (
                  <p className="px-2 py-2 text-xs text-muted-foreground">直接开始一段新对话</p>
                )}
              </section>
            )}
          </ScrollArea>
        </Tabs.Panel>
      </Tabs.Root>
      <Button
        variant="ghost"
        className="mx-3 mt-3 h-8 justify-start gap-2.5 px-2 text-[13px] text-muted-foreground"
        onClick={onSettings}
      >
        <Settings className="size-4 stroke-[1.6]" />
        设置
      </Button>
    </nav>
  )
}
