import { useShallow } from 'zustand/react/shallow'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, PanelLeft, PanelRight, Search } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { useOperationNotifications } from '@/app/use-operation-notifications'
import { themeOptions } from '@/app/theme-options'
import { ThemeToggleIcon } from '@/app/theme-toggle-icon'
import { useMediaQuery } from '@/app/use-media-query'
import { useWindowResizeMotion } from '@/app/use-window-resize-motion'
import { IconButton } from '@/components/icon-button'
import { WindowCaptionIcon } from '@/components/window-caption-icon'
import { DialogLayerProvider, useDialogLayers } from '@/components/dialog-layers'
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
import { useWorkspaceNavigation } from './use-workspace-navigation'
import { WorkspaceFloatingPanel } from './workspace-panel'
import { controlWindow, isDesktop } from '@/lib/desktop'
import { toast } from '@/lib/toast'
import type { ProjectInfo } from '@/lib/generated/pi'
import { isCurrentSession, sessionKey } from '@/lib/session-preferences'
import { findCachedSession } from '@/features/conversation/session-cache'
import { ConversationMenu } from './conversation-menu'

export function WorkspaceShell() {
  useOperationNotifications()
  return (
    <DialogLayerProvider>
      <WorkspaceLayout />
    </DialogLayerProvider>
  )
}

function WorkspaceLayout() {
  useWindowResizeMotion()
  const dialogLayers = useDialogLayers()
  const workspace = useWorkspaceStore(
    useShallow((state) => ({
      projectPath: state.projectPath,
      projects: state.projects,
      sessions: state.sessions,
      sidebarOpen: state.sidebarOpen,
      inspectorOpen: state.inspectorOpen,
      navigationWidth: state.navigationWidth,
      inspectorWidth: state.inspectorWidth,
      setNavigationWidth: state.setNavigationWidth,
      setInspectorWidth: state.setInspectorWidth,
      toggleSidebar: state.toggleSidebar,
      setInspectorOpen: state.setInspectorOpen,
      attachmentPreview: state.attachmentPreview,
      setAttachmentPreview: state.setAttachmentPreview,
      theme: state.theme,
      setTheme: state.setTheme,
    })),
  )
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
  const searchInput = useRef<HTMLInputElement>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  const searchReturnFocus = useRef<HTMLElement>(null)
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
  const projectPresence = useDialogPresence(projectDialog)
  const compact = useMediaQuery('(max-width: 1199px)')
  const narrow = useMediaQuery('(width < 960px)')
  const openSearch = useCallback(() => {
    if (!searchOpen && document.activeElement instanceof HTMLElement) {
      const target = document.activeElement
      searchReturnFocus.current = target.closest('.workspace-floating-panel')
        ? searchButton.current
        : target
    }
    setFloatingSidebarOpen(false)
    if (compact) setInspectorOpen(false)
    setSearchOpen(true)
    searchInput.current?.focus()
  }, [compact, searchOpen, setFloatingSidebarOpen, setInspectorOpen])
  if (floatingSidebar.narrow !== narrow) setFloatingSidebar({ narrow, open: false })
  const floatingSidebarOpen = floatingSidebar.narrow === narrow && floatingSidebar.open
  const dockedSidebarOpen = sidebarOpen && !narrow
  const sidebarVisible = narrow ? floatingSidebarOpen : sidebarOpen
  const { hostDocked: navigationDocked, ...navigationPanel } = useAnimatedPanel(
    sidebarOpen,
    navigationWidth,
    !narrow,
    floatingSidebarOpen,
  )
  const dockedInspectorOpen = inspectorOpen && !compact
  const floatingInspectorOpen = inspectorOpen && compact && !searchOpen
  const { hostDocked: inspectorDocked, ...inspectorPanel } = useAnimatedPanel(
    inspectorOpen,
    inspectorWidth,
    !compact,
    floatingInspectorOpen,
  )
  const contentDialogOpen =
    settingsOpen ||
    projectDialog !== null ||
    attachmentPreview !== null ||
    navigationState.deleteProject !== null ||
    navigationState.renameSession !== null
  const dialogOpen =
    contentDialogOpen ||
    searchOpen ||
    (floatingSidebarOpen && narrow) ||
    floatingInspectorOpen ||
    Boolean(dialogLayers?.layers.length)
  const desktop = isDesktop()
  const projectName =
    workspace.projects.find((item) => sessionKey(item.path) === sessionKey(projectPath))?.name ??
    projectPath?.split(/[\\/]/).filter(Boolean).at(-1)
  const session = workspace.sessions.find((session) => isCurrentSession(session, conversation))
  const themeIndex = themeOptions.findIndex((item) => item.value === theme)
  const { label: themeLabel } = themeOptions[themeIndex] ?? themeOptions[0]
  const nextTheme = themeOptions[(themeIndex + 1) % themeOptions.length]
  const inspector = <Inspector tab={inspectorTab} onTabChange={setInspectorTab} />

  useEffect(() => {
    // A docked inspector may become floating if the window shrinks during search.
    if (searchOpen && compact && inspectorOpen) setInspectorOpen(false)
  }, [compact, inspectorOpen, searchOpen, setInspectorOpen])

  useEffect(() => {
    if (!desktop) return
    const unsubscribe = useConversationStore.subscribe((state, previous) => {
      const sameRuntime =
        state.instanceId !== null &&
        state.instanceId === previous.instanceId &&
        state.sessionId === previous.sessionId
      const started =
        sameRuntime &&
        state.activeRunId !== null &&
        state.activeRunId !== previous.activeRunId &&
        state.status === 'running'
      const completed =
        sameRuntime &&
        previous.activeRunId !== null &&
        state.activeRunId === null &&
        state.status === 'ready'
      const messageActivity =
        sameRuntime &&
        previous.status !== 'connecting' &&
        state.messages.length > previous.messages.length &&
        (state.activeRunId !== null || state.lastLocalActivityAt !== previous.lastLocalActivityAt)
      const finished =
        state.status === 'ready' &&
        (state.lastLocalActivityAt !== previous.lastLocalActivityAt ||
          (previous.activeRunId !== null && state.activeRunId === null))
      const backgroundFinished = [...previous.backgroundSessions].filter(
        ([id]) => !state.backgroundSessions.has(id) && state.instanceId !== id,
      )
      if (
        state.instanceId !== previous.instanceId ||
        state.sessionId !== previous.sessionId ||
        state.sessionFile !== previous.sessionFile ||
        state.messages.length !== previous.messages.length ||
        started ||
        finished
      )
        useWorkspaceStore.getState().syncActiveSession()
      if (started || completed || messageActivity)
        useWorkspaceStore.getState().promoteSession(state)
      for (const [, { data }] of backgroundFinished) {
        const cached = findCachedSession(state.sessionCache, data.sessionId, data.sessionFile)?.[1]
        const before = findCachedSession(
          previous.sessionCache,
          data.sessionId,
          data.sessionFile,
        )?.[1]
        if (
          cached &&
          cached !== before &&
          cached.display.lastLocalActivityAt !== data.lastLocalActivityAt
        )
          useWorkspaceStore.getState().promoteSession(data)
      }
      if (finished || backgroundFinished.length) void useWorkspaceStore.getState().refresh()
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
        !event.isComposing
      ) {
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', search, true)
    return () => window.removeEventListener('keydown', search, true)
  }, [openSearch])

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
    void controlWindow(action).catch((reason: unknown) => toast.error(reason))
  }

  function toggleWorkspacePanel(side: 'left' | 'right') {
    if (searchOpen) {
      searchReturnFocus.current = null
      setSearchOpen(false)
    }
    if (side === 'left') {
      if (narrow) {
        if (!floatingSidebarOpen) setInspectorOpen(false)
        setFloatingSidebarOpen(!floatingSidebarOpen)
      } else toggleSidebar()
    } else {
      setFloatingSidebarOpen(false)
      setInspectorOpen(!inspectorOpen)
    }
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
          onClick={() => toggleWorkspacePanel('left')}
        >
          <PanelLeft />
        </IconButton>
        <IconButton
          ref={searchButton}
          variant="titlebar"
          label="搜索会话"
          title="搜索会话 (Ctrl+K)"
          onClick={openSearch}
        >
          <Search />
        </IconButton>
        <IconButton
          variant="titlebar"
          label={`切换主题（当前：${themeLabel}）`}
          title={`主题：${themeLabel}，点击切换为${nextTheme.label}`}
          onClick={() => setTheme(nextTheme.value)}
        >
          <ThemeToggleIcon />
        </IconButton>
        <div data-tauri-drag-region className="h-full flex-1" />
        <IconButton
          variant="titlebar"
          label={inspectorOpen ? '收起查看面板' : '打开查看面板'}
          aria-expanded={inspectorOpen}
          onClick={() => toggleWorkspacePanel('right')}
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
              <WindowCaptionIcon action="minimize" />
            </button>
            <button
              type="button"
              aria-label="最大化或还原窗口"
              className="caption-button"
              onClick={() => windowAction('maximize')}
            >
              <WindowCaptionIcon action="maximize" />
            </button>
            <button
              type="button"
              aria-label="关闭窗口"
              className="caption-button caption-close"
              onClick={() => windowAction('close')}
            >
              <WindowCaptionIcon action="close" />
            </button>
          </div>
        )}
      </header>
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
            style={{ overflow: 'hidden', position: 'relative' }}
          >
            {navigationDocked && (
              <div
                className="workspace-panel-content"
                data-side="left"
                data-panel-open={dockedSidebarOpen}
                aria-hidden={!dockedSidebarOpen}
                inert={!dockedSidebarOpen}
              >
                {navigation()}
              </div>
            )}
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
                    <div
                      data-slot="conversation-header"
                      className="flex h-11 shrink-0 items-center gap-3 border-b border-border/60 px-4 text-[13px]"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {projectPath && (
                          <>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="max-w-48 truncate text-muted-foreground" />
                                }
                              >
                                {projectName ?? projectPath}
                              </TooltipTrigger>
                              <TooltipContent showArrow={false} className="max-w-96 wrap-anywhere">
                                {projectPath}
                              </TooltipContent>
                            </Tooltip>
                            <ChevronRight
                              aria-hidden
                              className="size-3 shrink-0 text-muted-foreground"
                            />
                          </>
                        )}
                        <span className="min-w-0 truncate">
                          {session?.title ?? conversation.firstUserText ?? '新对话'}
                        </span>
                      </div>
                      <ConversationMenu
                        session={session}
                        onRename={navigationState.setRenameSession}
                      />
                    </div>
                    <ConversationPanel
                      onCreateProject={createProject}
                      onSettings={() => setSettingsOpen(true)}
                      onResume={openSearch}
                      onRename={() => {
                        if (session) navigationState.setRenameSession(session)
                      }}
                    />
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
                  style={{ overflow: 'hidden', position: 'relative' }}
                >
                  {inspectorDocked && (
                    <div
                      data-slot="workspace-inspector-frame"
                      className="workspace-surface workspace-panel-content bg-card"
                      data-side="right"
                      data-panel-open={dockedInspectorOpen}
                      aria-hidden={!dockedInspectorOpen}
                      inert={!dockedInspectorOpen}
                    >
                      {inspector}
                    </div>
                  )}
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
          title="项目与会话"
          description="选择项目、切换会话或打开设置。"
          keepMounted
        >
          {navigation()}
        </WorkspaceFloatingPanel>
      )}
      {!inspectorDocked && (
        <WorkspaceFloatingPanel
          open={floatingInspectorOpen}
          onOpenChange={setInspectorOpen}
          side="right"
          title="项目文件与变更"
          description="查看当前项目的文件和 Git 差异。"
        >
          {inspector}
        </WorkspaceFloatingPanel>
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <WorkspaceNavigationDialogs navigation={navigationState} />
      <SessionSearchDialog
        open={searchOpen}
        inputRef={searchInput}
        returnFocus={searchReturnFocus}
        onClose={() => setSearchOpen(false)}
      />
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
