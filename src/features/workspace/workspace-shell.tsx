import { useEffect, useState } from 'react'
import { ChevronRight, Minus, PanelLeft, PanelRight, Search, Square, X } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { useMediaQuery } from '@/app/use-media-query'
import { IconButton } from '@/components/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { WorkspaceDialog } from '@/components/workspace-dialog'
import { useDialogPresence } from '@/components/use-dialog-presence'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ConversationPanel } from '@/features/conversation/conversation-panel'
import { AttachmentPreviewDialog } from '@/features/conversation/attachment-preview-dialog'
import { useConversationStore } from '@/features/conversation/store'
import { SettingsDialog } from '@/features/settings/settings-dialog'
import { Inspector } from './inspector'
import { WorkspaceNavigation } from './workspace-navigation'
import { ProjectDialog } from './project-dialog'
import { SessionSearchDialog } from './session-search-dialog'
import { useAnimatedPanel } from './use-animated-panel'
import { controlWindow, isDesktop, selectProjectDirectory } from '@/lib/desktop'
import type { ProjectInfo } from '@/lib/generated/pi'

export function WorkspaceShell() {
  const workspace = useWorkspaceStore()
  const {
    projectPath,
    sidebarOpen,
    inspectorOpen,
    toggleSidebar,
    setInspectorOpen,
    attachmentPreview,
    setAttachmentPreview,
  } = workspace
  const conversation = useConversationStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [projectDialog, setProjectDialog] = useState<ProjectInfo | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const searchPresence = useDialogPresence(searchOpen ? true : null)
  const projectPresence = useDialogPresence(projectDialog)
  const attachmentPresence = useDialogPresence(attachmentPreview)
  const compact = useMediaQuery('(max-width: 1199px)')
  const navigationPanel = useAnimatedPanel(sidebarOpen, 260)
  const dockedInspectorOpen = inspectorOpen && !compact
  const inspectorPanel = useAnimatedPanel(dockedInspectorOpen, 400)
  const dialogOpen =
    settingsOpen ||
    searchOpen ||
    projectDialog !== null ||
    attachmentPreview !== null ||
    (inspectorOpen && compact)
  const desktop = isDesktop()
  const projectName = projectPath?.split(/[\\/]/).filter(Boolean).at(-1)
  const session = workspace.sessions.find((session) => session.path === conversation.sessionFile)

  useEffect(() => {
    if (!desktop) return
    void useWorkspaceStore.getState().initialize()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void useWorkspaceStore.getState().refresh()
    }, 15000)
    const refresh = () => {
      void useWorkspaceStore.getState().refresh()
    }
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [desktop])

  useEffect(() => {
    const search = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'k' &&
        (!dialogOpen || searchOpen)
      ) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', search)
    return () => window.removeEventListener('keydown', search)
  }, [dialogOpen, searchOpen])

  async function addProject() {
    setError(null)
    try {
      const selected = await selectProjectDirectory()
      if (selected) await workspace.addProject(selected)
    } catch (reason) {
      setError(String(reason))
    }
  }

  function windowAction(action: 'minimize' | 'maximize' | 'close') {
    void controlWindow(action).catch((reason: unknown) => setError(String(reason)))
  }

  return (
    <div className="workspace-shell flex h-dvh min-h-0 flex-col overflow-hidden text-foreground">
      <header
        data-window-header
        data-tauri-drag-region
        className="flex h-(--titlebar-height) shrink-0 items-center pl-4 select-none"
      >
        <span
          data-tauri-drag-region
          className="mr-5 inline-flex items-center gap-2 text-[13px] font-medium"
        >
          <img
            src="/pi.svg"
            alt=""
            draggable={false}
            className="pointer-events-none size-4 shrink-0"
          />
          Pi Hearth
        </span>
        <IconButton label={sidebarOpen ? '收起侧栏' : '展开侧栏'} onClick={toggleSidebar}>
          <PanelLeft />
        </IconButton>
        <IconButton
          label="搜索会话"
          title="搜索会话 (Ctrl+K)"
          onClick={() => setSearchOpen(true)}
          disabled={dialogOpen && !searchOpen}
        >
          <Search />
        </IconButton>
        <div data-tauri-drag-region className="h-full flex-1" />
        <IconButton
          label={inspectorOpen ? '收起查看面板' : '打开查看面板'}
          aria-expanded={inspectorOpen}
          onClick={() => setInspectorOpen(!inspectorOpen)}
        >
          <PanelRight />
        </IconButton>
        {desktop && (
          <div className="ml-2 flex h-full">
            <button
              type="button"
              aria-label="最小化窗口"
              className="caption-button"
              onClick={() => windowAction('minimize')}
            >
              <Minus />
            </button>
            <button
              type="button"
              aria-label="最大化或还原窗口"
              className="caption-button"
              onClick={() => windowAction('maximize')}
            >
              <Square />
            </button>
            <button
              type="button"
              aria-label="关闭窗口"
              className="caption-button caption-close"
              onClick={() => windowAction('close')}
            >
              <X />
            </button>
          </div>
        )}
      </header>
      {(error || workspace.error) && (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
          {error || workspace.error}
        </p>
      )}
      <div
        className="workspace-body min-h-0 flex-1"
        data-sidebar-open={sidebarOpen}
        inert={dialogOpen}
      >
        <ResizablePanelGroup
          orientation="horizontal"
          className="workspace-panel-group"
          onLayoutChanged={(layout, { isUserInteraction }) => {
            if (!isUserInteraction) return
            const open = layout.navigation > 0
            if (open !== sidebarOpen) toggleSidebar()
          }}
        >
          <ResizablePanel
            id="navigation"
            {...navigationPanel}
            groupResizeBehavior="preserve-pixel-size"
            collapsible
            minSize="220px"
            maxSize="400px"
            style={{ overflow: 'hidden' }}
          >
            <div
              className="workspace-panel-content"
              data-panel-open={sidebarOpen}
              aria-hidden={!sidebarOpen}
              inert={!sidebarOpen}
            >
              <WorkspaceNavigation
                desktop={desktop}
                onAdd={() => void addProject()}
                onCreate={() => setProjectDialog('create')}
                onSettings={() => setSettingsOpen(true)}
                onInstructions={setProjectDialog}
              />
            </div>
          </ResizablePanel>
          <ResizableHandle
            className="workspace-panel-separator bg-transparent"
            data-panel-open={sidebarOpen}
            disabled={!sidebarOpen}
          />
          <ResizablePanel id="content" minSize="400px">
            <ResizablePanelGroup
              orientation="horizontal"
              className="workspace-surface workspace-panel-group"
              onLayoutChanged={(layout, { isUserInteraction }) => {
                if (!isUserInteraction || compact) return
                const open = layout.inspector > 0
                if (open !== inspectorOpen) setInspectorOpen(open)
              }}
            >
              <ResizablePanel id="conversation" minSize="400px">
                <main aria-label="对话工作区" className="flex h-full min-h-0 flex-col">
                  <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-7 text-[13px]">
                    <Tooltip>
                      <TooltipTrigger
                        disabled={!projectPath}
                        render={<span className="shrink-0 text-muted-foreground" />}
                      >
                        {projectName ?? '聊天'}
                      </TooltipTrigger>
                      <TooltipContent showArrow={false} className="max-w-96 wrap-anywhere">
                        {projectPath}
                      </TooltipContent>
                    </Tooltip>
                    <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {session?.title ??
                        conversation.messages.find((message) => message.role === 'user')?.text ??
                        '新对话'}
                    </span>
                  </div>
                  <ConversationPanel />
                </main>
              </ResizablePanel>
              <ResizableHandle
                className="workspace-panel-separator"
                data-panel-open={dockedInspectorOpen}
                disabled={!dockedInspectorOpen}
              />
              <ResizablePanel
                id="inspector"
                {...inspectorPanel}
                collapsible
                minSize="300px"
                maxSize="560px"
                style={{ overflow: 'hidden' }}
              >
                <div
                  className="workspace-panel-content"
                  data-side="right"
                  data-panel-open={dockedInspectorOpen}
                  aria-hidden={!dockedInspectorOpen}
                  inert={!dockedInspectorOpen}
                >
                  <Inspector />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <WorkspaceDialog open={inspectorOpen && compact} onOpenChange={setInspectorOpen}>
        <DialogContent
          showCloseButton={false}
          data-dialog-layout="drawer"
          className="top-(--titlebar-height) right-(--workspace-inset) left-auto h-[calc(100dvh-var(--titlebar-height)-var(--workspace-inset))] w-100 translate-x-0 translate-y-0 gap-0 p-0 sm:max-w-100"
        >
          <DialogTitle className="sr-only">项目文件与变更</DialogTitle>
          <DialogDescription className="sr-only">查看当前项目的文件和 Git 差异。</DialogDescription>
          <Inspector />
        </DialogContent>
      </WorkspaceDialog>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {searchPresence.value && (
        <SessionSearchDialog
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onOpenChangeComplete={searchPresence.onOpenChangeComplete}
        />
      )}
      {attachmentPresence.value && (
        <AttachmentPreviewDialog
          key={attachmentPresence.value.id}
          file={attachmentPresence.value}
          open={attachmentPreview !== null}
          onClose={() => setAttachmentPreview(null)}
          onOpenChangeComplete={attachmentPresence.onOpenChangeComplete}
        />
      )}
      {projectPresence.value && (
        <ProjectDialog
          key={
            typeof projectPresence.value === 'string'
              ? projectPresence.value
              : projectPresence.value.path
          }
          project={typeof projectPresence.value === 'string' ? undefined : projectPresence.value}
          open={projectDialog !== null}
          onClose={() => setProjectDialog(null)}
          onOpenChangeComplete={projectPresence.onOpenChangeComplete}
        />
      )}
    </div>
  )
}
