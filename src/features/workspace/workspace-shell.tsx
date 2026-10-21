import { useEffect, useState } from 'react'
import { ChevronRight, Minus, PanelLeft, PanelRight, Search, Square, X } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { useMediaQuery } from '@/app/use-media-query'
import { IconButton } from '@/components/icon-button'
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { WorkspaceDialog } from '@/components/workspace-dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ConversationPanel } from '@/features/conversation/conversation-panel'
import { AttachmentPreviewDialog } from '@/features/conversation/attachment-preview-dialog'
import { useConversationStore } from '@/features/conversation/store'
import { SettingsDialog } from '@/features/settings/settings-dialog'
import { Inspector } from './inspector'
import { WorkspaceNavigation } from './workspace-navigation'
import { ProjectDialog } from './project-dialog'
import { SessionSearchDialog } from './session-search-dialog'
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
  const compact = useMediaQuery('(max-width: 1199px)')
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
        <ResizablePanelGroup orientation="horizontal">
          {sidebarOpen && (
            <>
              <ResizablePanel id="navigation" defaultSize="260px" minSize="220px" maxSize="400px">
                <WorkspaceNavigation
                  desktop={desktop}
                  onAdd={() => void addProject()}
                  onCreate={() => setProjectDialog('create')}
                  onSettings={() => setSettingsOpen(true)}
                  onInstructions={setProjectDialog}
                />
              </ResizablePanel>
              <ResizableHandle className="bg-transparent" />
            </>
          )}
          <ResizablePanel id="content" minSize="400px">
            <ResizablePanelGroup orientation="horizontal" className="workspace-surface">
              <ResizablePanel id="conversation" minSize="400px">
                <main aria-label="对话工作区" className="flex h-full min-h-0 flex-col">
                  <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-7 text-[13px]">
                    <span
                      className="shrink-0 text-muted-foreground"
                      title={projectPath ?? undefined}
                    >
                      {projectName ?? '聊天'}
                    </span>
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
              {inspectorOpen && !compact && (
                <>
                  <ResizableHandle />
                  <ResizablePanel
                    id="inspector"
                    defaultSize="400px"
                    minSize="300px"
                    maxSize="560px"
                  >
                    <Inspector />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <WorkspaceDialog open={inspectorOpen && compact} onOpenChange={setInspectorOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-(--titlebar-height) right-(--workspace-inset) left-auto h-[calc(100dvh-var(--titlebar-height)-var(--workspace-inset))] w-100 translate-x-0 translate-y-0 gap-0 rounded-md p-0 sm:max-w-100"
        >
          <DialogTitle className="sr-only">项目文件与变更</DialogTitle>
          <DialogDescription className="sr-only">查看当前项目的文件和 Git 差异。</DialogDescription>
          <Inspector />
        </DialogContent>
      </WorkspaceDialog>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {searchOpen && <SessionSearchDialog onClose={() => setSearchOpen(false)} />}
      {attachmentPreview && (
        <AttachmentPreviewDialog
          key={attachmentPreview.id}
          file={attachmentPreview}
          onClose={() => setAttachmentPreview(null)}
        />
      )}
      {projectDialog && (
        <ProjectDialog
          key={typeof projectDialog === 'string' ? projectDialog : projectDialog.path}
          project={typeof projectDialog === 'string' ? undefined : projectDialog}
          onClose={() => setProjectDialog(null)}
        />
      )}
    </div>
  )
}
