import { useEffect, useRef, useState } from 'react'
import { Folder, FolderOpen, FolderPlus, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/scroll-area'
import { WorkspaceDialog } from '@/components/workspace-dialog'
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { isDesktop, selectProjectDirectory } from '@/lib/desktop'
import { listenForProjectFolderDrop, resolveProjectDirectory } from '@/lib/project-directory'
import { readInstructions, saveInstructions } from '@/lib/workspace'
import { useWorkspaceStore } from '@/app/store'
import type { ProjectInfo } from '@/lib/generated/pi'

export function ProjectDialog({
  project,
  open = true,
  onClose,
  onOpenChangeComplete,
}: {
  project?: ProjectInfo
  open?: boolean
  onClose: () => void
  onOpenChangeComplete?: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [defaultDirectory, setDefaultDirectory] = useState('')
  const [dragging, setDragging] = useState(false)
  const sourceArea = useRef<HTMLDivElement>(null)
  const actionPending = useRef(false)
  const selectionVersion = useRef(0)
  const projectsDirectory = useWorkspaceStore((state) => state.projectsDirectory)
  const [selecting, setSelecting] = useState(false)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [file, setFile] = useState('')
  const [loading, setLoading] = useState(Boolean(project))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const sourceName = source?.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const createDirectory = projectsDirectory || defaultDirectory || '文档\\Pi Hearth\\Projects'
  const desktop = isDesktop()
  const canSubmit = Boolean(!saving && !selecting && !loading && (project || source || name.trim()))

  useEffect(
    () => () => {
      selectionVersion.current++
    },
    [],
  )

  useEffect(() => {
    if (!open || project || projectsDirectory || !desktop) return
    let disposed = false
    void resolveProjectDirectory().then(
      (directory) => {
        if (!disposed) setDefaultDirectory(directory)
      },
      (reason: unknown) => {
        if (!disposed) setError(String(reason))
      },
    )
    return () => {
      disposed = true
    }
  }, [open, project, projectsDirectory, desktop])

  useEffect(() => {
    if (!open || project || !desktop) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void listenForProjectFolderDrop((event) => {
      if (disposed || actionPending.current) return
      if (event.type === 'leave') {
        setDragging(false)
        return
      }
      const bounds = sourceArea.current?.getBoundingClientRect()
      const x = event.position.x / window.devicePixelRatio
      const y = event.position.y / window.devicePixelRatio
      const inside = Boolean(
        bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom,
      )
      setDragging(event.type !== 'drop' && inside)
      if (event.type === 'drop' && inside) {
        if (event.paths.length !== 1) {
          setError('每个项目请选择一个源文件夹。')
          return
        }
        void chooseDirectory('source', event.paths[0])
      }
    })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(String(reason))
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [open, project, desktop])

  useEffect(() => {
    if (!project) return
    let disposed = false
    readInstructions(project.path).then(
      (value) => {
        if (!disposed) {
          setContent(value.content)
          setOriginal(value.content)
          setFile(value.path)
          setLoading(false)
        }
      },
      (reason: unknown) => {
        if (!disposed) {
          setError(String(reason))
          setLoading(false)
        }
      },
    )
    return () => {
      disposed = true
    }
  }, [project])

  async function submit() {
    if (!canSubmit || actionPending.current) return
    actionPending.current = true
    setSaving(true)
    setError('')
    try {
      if (project) {
        await saveInstructions(project.path, content, original)
        if (useWorkspaceStore.getState().projectPath === project.path)
          await useWorkspaceStore.getState().reloadCurrent()
      } else {
        await useWorkspaceStore
          .getState()
          .addProject({ sourcePath: source, name: name.trim() || null })
      }
      onClose()
    } catch (reason) {
      setError(String(reason))
    } finally {
      actionPending.current = false
      setSaving(false)
    }
  }

  async function chooseDirectory(target: 'source' | 'location', path?: string) {
    if (actionPending.current) return
    actionPending.current = true
    const request = ++selectionVersion.current
    setSelecting(true)
    setError('')
    try {
      const value =
        path ??
        (await selectProjectDirectory(target === 'source' ? '添加源文件夹' : '新项目保存位置'))
      if (value) {
        const directory = await resolveProjectDirectory(value)
        if (request !== selectionVersion.current) return
        if (target === 'source') setSource(directory)
        else useWorkspaceStore.getState().setProjectsDirectory(directory)
      }
    } catch (reason) {
      if (request === selectionVersion.current) setError(String(reason))
    } finally {
      if (request === selectionVersion.current) {
        actionPending.current = false
        setSelecting(false)
      }
    }
  }

  return (
    <WorkspaceDialog
      open={open}
      onOpenChangeComplete={onOpenChangeComplete}
      onOpenChange={(open, details) => {
        if (!open && actionPending.current) {
          details.cancel()
          return
        }
        if (!open) onClose()
      }}
    >
      <DialogContent
        className={`max-h-[calc(100dvh-var(--titlebar-height)-3rem)] overflow-hidden ${project ? 'sm:max-w-160' : 'rounded-2xl sm:max-w-136'}`}
      >
        <DialogHeader className={project ? undefined : 'border-0 pb-0'}>
          <DialogTitle>{project ? `${project.name} · 项目指令` : '创建项目'}</DialogTitle>
          <DialogDescription className={project ? undefined : 'sr-only'}>
            {project
              ? '保存到项目的指令文件，该项目的所有会话与 Pi CLI 均可使用。'
              : '填写项目名称，或添加源文件夹。未添加文件夹时，在设置的保存位置创建项目。'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <ScrollArea
            className="-m-1"
            viewportClassName="max-h-[calc(100dvh-var(--titlebar-height)-18rem)] p-1"
          >
            <div className="space-y-4">
              {project ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground break-all">
                    {file || '正在读取指令文件…'}
                  </p>
                  <Textarea
                    aria-label="项目指令"
                    disabled={loading || saving}
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    className="min-h-64 max-h-96"
                    placeholder="例如：使用中文回答；修改前先阅读现有代码；遵循项目约定。"
                  />
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center border-r text-muted-foreground">
                        <Folder aria-hidden className="size-4 stroke-[1.5]" />
                      </span>
                      <Input
                        aria-label="项目名称"
                        aria-describedby={source ? 'project-name-hint' : undefined}
                        placeholder={sourceName || '项目名称'}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        disabled={saving || selecting}
                        className="h-10 rounded-xl pl-13"
                        autoFocus
                      />
                    </div>
                    {source && (
                      <p id="project-name-hint" className="text-xs text-muted-foreground">
                        可留空，使用文件夹名称作为项目名。
                      </p>
                    )}
                  </div>
                  <section aria-label="源文件夹" className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">源文件夹</h3>
                      {selecting && (
                        <span
                          role="status"
                          className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                          正在选择文件夹…
                        </span>
                      )}
                    </div>
                    <div
                      ref={sourceArea}
                      aria-label="源文件夹拖放区"
                      className={`overflow-hidden rounded-xl border border-dashed transition-colors ${dragging ? 'border-ring bg-muted/40' : ''}`}
                      onDragOver={(event) => {
                        if (!actionPending.current && event.dataTransfer.types.includes('Files')) {
                          event.preventDefault()
                          setDragging(true)
                        }
                      }}
                      onDragLeave={(event) => {
                        if (
                          !(event.relatedTarget instanceof Node) ||
                          !event.currentTarget.contains(event.relatedTarget)
                        )
                          setDragging(false)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDragging(false)
                        if (!desktop) setError('拖拽文件夹需要在桌面应用中使用。')
                      }}
                    >
                      {source ? (
                        <>
                          <div className="flex items-start gap-3 p-3.5">
                            <FolderOpen
                              aria-hidden
                              className="mt-0.5 size-4 shrink-0 stroke-[1.5] text-muted-foreground"
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="break-all">{sourceName}</p>
                              <p className="text-xs leading-5 text-muted-foreground break-all">
                                {source}
                              </p>
                            </div>
                            <Button
                              aria-label="移除文件夹"
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-foreground"
                              disabled={saving || selecting}
                              onClick={() => {
                                setSource(null)
                                setError('')
                              }}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-1 border-t px-2 py-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={saving || selecting}
                              onClick={() => void chooseDirectory('source')}
                            >
                              <FolderOpen className="stroke-[1.5]" />
                              更换文件夹
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-5">
                          <p className="mb-1 text-xs text-muted-foreground">
                            {dragging ? '松开以添加文件夹' : '拖拽文件夹到此处'}
                          </p>
                          <div className="flex flex-wrap justify-center gap-2">
                            <Button
                              variant="secondary"
                              className="rounded-full"
                              disabled={saving || selecting}
                              onClick={() => void chooseDirectory('source')}
                            >
                              <FolderPlus className="stroke-[1.5]" />
                              添加文件夹
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    {!source && (
                      <div className="flex items-start gap-3 text-xs text-muted-foreground">
                        <div className="min-w-0 flex-1 space-y-1 leading-5">
                          <p>未添加源文件夹时，将在以下位置创建项目</p>
                          <p className="break-all">{createDirectory}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={saving || selecting}
                          onClick={() => void chooseDirectory('location')}
                        >
                          更改
                        </Button>
                      </div>
                    )}
                  </section>
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter
            className={
              project ? undefined : 'mx-0 mb-0 gap-3 border-0 bg-transparent px-0 pt-2 pb-0'
            }
          >
            <Button
              variant={project ? 'outline' : 'ghost'}
              disabled={saving || selecting}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saving ? (project ? '正在保存…' : '正在创建…') : project ? '保存指令' : '创建项目'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </WorkspaceDialog>
  )
}
