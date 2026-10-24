import { useShallow } from 'zustand/react/shallow'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Minus, PanelLeft, PanelRight, Search, Square, X } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { themeOptions } from '@/app/theme-options'
import { useMediaQuery } from '@/app/use-media-query'
import { useWindowResizeMotion } from '@/app/use-window-resize-motion'
import { IconButton } from '@/components/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDialogPresence } from '@/components/use-dialog-presence'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ConversationPanel } from '@/features/conversation/conversation-panel'
import { AttachmentPreviewDialog } from '@/features/conversation/attachment-preview-dialog'
import { useConversationStore } from '@/features/conversation/store'
import { SettingsDialog } from '@/features/settings/settings-dialog'
import { Inspector, type InspectorTab } from './inspector'
import { WorkspaceNavigationContent, WorkspaceNavigationDialogs } from './workspace-navigation'
import { ProjectDialog } from './project-dialog'
import { SessionSearchDialog } from './session-search-dialog'
import { useAnimatedPanel } from './use-animated-panel'
import { usePanelPresentation } from './use-panel-presentation'
import { useWorkspaceNavigation } from './use-workspace-navigation'
import { WorkspaceFloatingPanel } from './workspace-panel'
import { controlWindow, isDesktop } from '@/lib/desktop'
import type { ProjectInfo } from '@/lib/generated/pi'
import { isCurrentSession, sessionKey } from '@/lib/session-preferences'

export function WorkspaceShell() {
  useWindowResizeMotion()
  const workspace = useWorkspaceStore()
  const {
    projectPath,
    sidebarOpen,
    inspectorOpen,
    navigationWidth,
    inspectorWidth,
    setNavigationWidth,
    setInspectorWidth,
    toggleSidebar,
    setInspectorOpen,
    attachmentPreview,
    setAttachmentPreview,
    theme,
    setTheme,
  } = workspace
  const conversation = useConversationStore(
    useShallow((state) => ({
      sessionFile: state.sessionFile,
      sessionId: state.sessionId,
      firstUserText: state.messages.find((message) => message.role === 'user')?.text,
    })),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('changes')
  const [floatingSidebar, setFloatingSidebar] = useState({ narrow: false, open: false })
  const navigationState = useWorkspaceNavigation()
  const setFloatingSidebarOpen = useCallback(
    (open: boolean) => setFloatingSidebar((state) => ({ ...state, open })),
    [],
  )
  const [projectDialog, setProjectDialog] = useState<ProjectInfo | 'create' | null>(null)
  const createProject = useCallback(() => {
    setFloatingSidebarOpen(false)
    setProjectDialog('create')
  }, [setFloatingSidebarOpen])
  const [error, setError] = useState<string | null>(null)
  const projectPresence = useDialogPresence(projectDialog)
  const compact = useMediaQuery('(max-width: 1199px)')
  const narrow = useMediaQuery('(width < 960px)')
  if (floatingSidebar.narrow !== narrow) setFloatingSidebar({ narrow, open: false })
  const floatingSidebarOpen = floatingSidebar.narrow === narrow && floatingSidebar.open
  const dockedSidebarOpen = sidebarOpen && !narrow
  const sidebarVisible = narrow ? floatingSidebarOpen : sidebarOpen
  const navigationElementRef = useRef<HTMLDivElement | null>(null)
  const inspectorElementRef = useRef<HTMLDivElement | null>(null)
  const navigationDocked = usePanelPresentation({
    docked: !narrow,
    open: sidebarOpen,
    floatingOpen: floatingSidebarOpen,
    side: 'left',
    elementRef: navigationElementRef,
  })
  const inspectorDocked = usePanelPresentation({
    docked: !compact,
    open: inspectorOpen,
    floatingOpen: inspectorOpen && compact,
    side: 'right',
    elementRef: inspectorElementRef,
  })
  const navigationPanel = useAnimatedPanel(
    sidebarOpen,
    navigationWidth,
    !narrow,
    navigationElementRef,
  )
  const dockedInspectorOpen = inspectorOpen && !compact
  const inspectorPanel = useAnimatedPanel(
    inspectorOpen,
    inspectorWidth,
    !compact,
    inspectorElementRef,
  )
  const contentDialogOpen =
    settingsOpen ||
    searchOpen ||
    projectDialog !== null ||
    attachmentPreview !== null ||
    navigationState.deleteProject !== null ||
    navigationState.renameSession !== null
  const dialogOpen =
    contentDialogOpen || (floatingSidebarOpen && narrow) || (inspectorOpen && compact)
  const desktop = isDesktop()
  const projectName =
    workspace.projects.find((item) => sessionKey(item.path) === sessionKey(projectPath))?.name ??
    projectPath?.split(/[\\/]/).filter(Boolean).at(-1)
  const session = workspace.sessions.find((session) => isCurrentSession(session, conversation))
  const themeIndex = themeOptions.findIndex((item) => item.value === theme)
  const { label: themeLabel, icon: ThemeIcon } = themeOptions[themeIndex] ?? themeOptions[0]
  const nextTheme = themeOptions[(themeIndex + 1) % themeOptions.length]
  const inspector = <Inspector tab={inspectorTab} onTabChange={setInspectorTab} />

  useEffect(() => {
    if (!desktop) return
    const unsubscribe = useConversationStore.subscribe((state, previous) => {
      const finished =
        state.status === 'ready' &&
        (state.lastLocalActivityAt !== previous.lastLocalActivityAt ||
          (previous.activeRunId !== null && state.activeRunId === null))
      if (
        state.instanceId !== previous.instanceId ||
        state.sessionId !== previous.sessionId ||
        state.sessionFile !== previous.sessionFile ||
        state.messages.length !== previous.messages.length ||
        finished
      )
        useWorkspaceStore.getState().syncActiveSession()
      if (finished) void useWorkspaceStore.getState().refresh()
    })
    useWorkspaceStore.getState().syncActiveSession()
    void useWorkspaceStore.getState().initialize()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void useWorkspaceStore.getState().refresh()
    }, 15000)
    const refresh = () => {
      void useWorkspaceStore.getState().refresh()
    }
    window.addEventListener('focus', refresh)
    return () => {
      unsubscribe()
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [desktop])

  useEffect(() => {
    const search = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'k' &&
        (!dialogOpen || searchOpen || (floatingSidebarOpen && narrow))
      ) {
        event.preventDefault()
        setFloatingSidebarOpen(false)
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', search)
    return () => window.removeEventListener('keydown', search)
  }, [dialogOpen, searchOpen, floatingSidebarOpen, narrow, setFloatingSidebarOpen])

  function navigation() {
    return (
      <WorkspaceNavigationContent
        desktop={desktop}
        navigation={navigationState}
        onNavigate={() => setFloatingSidebarOpen(false)}
        onClose={navigationDocked ? undefined : () => setFloatingSidebarOpen(false)}
        onCreate={createProject}
        onSettings={() => {
          setFloatingSidebarOpen(false)
          setSettingsOpen(true)
        }}
        onInstructions={(project) => {
          setFloatingSidebarOpen(false)
          setProjectDialog(project)
        }}
      />
    )
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
        <IconButton
          variant="titlebar"
          label={sidebarVisible ? '收起侧栏' : '展开侧栏'}
          aria-expanded={sidebarVisible}
          disabled={narrow && contentDialogOpen}
          onClick={() => {
            if (narrow) {
              if (!floatingSidebarOpen) setInspectorOpen(false)
              setFloatingSidebarOpen(!floatingSidebarOpen)
            } else toggleSidebar()
          }}
        >
          <PanelLeft />
        </IconButton>
        <IconButton
          variant="titlebar"
          label="搜索会话"
          title="搜索会话 (Ctrl+K)"
          onClick={() => {
            setFloatingSidebarOpen(false)
            setSearchOpen(true)
          }}
          disabled={dialogOpen && !searchOpen && !floatingSidebarOpen}
        >
          <Search />
        </IconButton>
        <IconButton
          variant="titlebar"
          label={`切换主题（当前：${themeLabel}）`}
          title={`主题：${themeLabel}，点击切换为${nextTheme.label}`}
          onClick={() => setTheme(nextTheme.value)}
        >
          <ThemeIcon />
        </IconButton>
        <div data-tauri-drag-region className="h-full flex-1" />
        <IconButton
          variant="titlebar"
          label={inspectorOpen ? '收起查看面板' : '打开查看面板'}
          aria-expanded={inspectorOpen}
          onClick={() => {
            setFloatingSidebarOpen(false)
            setInspectorOpen(!inspectorOpen)
          }}
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
        data-sidebar-open={dockedSidebarOpen}
        inert={dialogOpen}
      >
        <ResizablePanelGroup
          orientation="horizontal"
          className="workspace-panel-group"
          onLayoutChanged={(layout, { isUserInteraction }) => {
            if (!isUserInteraction || narrow) return
            const open = layout.navigation > 0
            if (open !== sidebarOpen) toggleSidebar()
            const width = navigationPanel.panelRef.current?.getSize().inPixels
            if (open && width) setNavigationWidth(width)
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
              data-panel-open={dockedSidebarOpen}
              aria-hidden={!dockedSidebarOpen}
              inert={!dockedSidebarOpen}
            >
              {navigationDocked && navigation()}
            </div>
          </ResizablePanel>
          <ResizableHandle
            aria-label="调整侧栏宽度"
            className="workspace-panel-separator z-10 w-0 bg-transparent after:w-2.5"
            data-panel-open={dockedSidebarOpen}
            disabled={!dockedSidebarOpen}
            disableDoubleClick
            onDoubleClick={() => {
              if (!dockedSidebarOpen) return
              const width = useWorkspaceStore.getInitialState().navigationWidth
              navigationPanel.panelRef.current?.resize(`${width}px`)
              setNavigationWidth(width)
            }}
          />
          <ResizablePanel id="content" minSize="400px">
            <div className="workspace-content-inset h-full min-w-0 flex-1">
              <ResizablePanelGroup
                orientation="horizontal"
                className="workspace-panel-group"
                onLayoutChanged={(layout, { isUserInteraction }) => {
                  if (!isUserInteraction || compact) return
                  const open = layout.inspector > 0
                  if (open !== inspectorOpen) setInspectorOpen(open)
                  const width = inspectorPanel.panelRef.current?.getSize().inPixels
                  if (open && width) setInspectorWidth(width)
                }}
              >
                <ResizablePanel id="conversation" minSize="400px">
                  <main
                    aria-label="对话工作区"
                    className="workspace-surface flex h-full min-h-0 flex-col bg-background"
                  >
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
                        {session?.title ?? conversation.firstUserText ?? '新对话'}
                      </span>
                    </div>
                    <ConversationPanel onCreateProject={createProject} />
                  </main>
                </ResizablePanel>
                <ResizableHandle
                  aria-label="调整查看面板宽度"
                  className="workspace-panel-separator w-(--workspace-inset) bg-transparent after:w-2.5"
                  data-panel-open={dockedInspectorOpen}
                  disabled={!dockedInspectorOpen}
                  disableDoubleClick
                  onDoubleClick={() => {
                    if (!dockedInspectorOpen) return
                    const width = useWorkspaceStore.getInitialState().inspectorWidth
                    inspectorPanel.panelRef.current?.resize(`${width}px`)
                    setInspectorWidth(width)
                  }}
                />
                <ResizablePanel
                  id="inspector"
                  {...inspectorPanel}
                  groupResizeBehavior="preserve-pixel-size"
                  collapsible
                  minSize="300px"
                  maxSize="560px"
                  style={{ overflow: 'hidden' }}
                >
                  <div
                    data-slot="workspace-inspector-frame"
                    className="workspace-surface workspace-panel-content bg-card"
                    data-side="right"
                    data-panel-open={dockedInspectorOpen}
                    aria-hidden={!dockedInspectorOpen}
                    inert={!dockedInspectorOpen}
                  >
                    {inspectorDocked && inspector}
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      {!navigationDocked && (
        <WorkspaceFloatingPanel
          open={narrow && floatingSidebarOpen}
          onOpenChange={setFloatingSidebarOpen}
          side="left"
          width={navigationWidth}
          title="项目与会话"
          description="选择项目、切换会话或打开设置。"
          keepMounted
        >
          {navigation()}
        </WorkspaceFloatingPanel>
      )}
      {!inspectorDocked && (
        <WorkspaceFloatingPanel
          open={compact && inspectorOpen}
          onOpenChange={setInspectorOpen}
          side="right"
          width={inspectorWidth}
          title="项目文件与变更"
          description="查看当前项目的文件和 Git 差异。"
        >
          {inspector}
        </WorkspaceFloatingPanel>
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <WorkspaceNavigationDialogs navigation={navigationState} />
      <SessionSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AttachmentPreviewDialog
        file={attachmentPreview}
        onClose={() => setAttachmentPreview(null)}
      />
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
