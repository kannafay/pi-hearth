import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, FolderPlus, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Field,
  FieldLabel,
  FieldTitle,
  FieldDescription,
  FieldError,
  FieldGroup,
} from '@/components/ui/field'
import { WorkspaceDialog } from '@/components/workspace-dialog'
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogBody,
  DialogForm,
} from '@/components/ui/dialog'
import { isDesktop, selectProjectDirectory } from '@/lib/desktop'
import { listenForProjectFolderDrop, resolveProjectDirectory } from '@/lib/project-directory'
import { readInstructions } from '@/lib/workspace'
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
  const [name, setName] = useState(project?.name ?? '')
  const [source, setSource] = useState<string | null>(project?.path ?? null)
  const [defaultDirectory, setDefaultDirectory] = useState('')
  const [dragging, setDragging] = useState(false)
  const sourceArea = useRef<HTMLDivElement>(null)
  const actionPending = useRef(false)
  const selectionVersion = useRef(0)
  const projectsDirectory = useWorkspaceStore((state) => state.projectsDirectory)
  const [selecting, setSelecting] = useState(false)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState<string | null>(project ? null : '')
  const [loading, setLoading] = useState(Boolean(project))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const sourceName = source?.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const createDirectory = projectsDirectory || defaultDirectory || '文档\\Pi Hearth\\Projects'
  const desktop = isDesktop()
  const canSubmit = Boolean(
    !saving && !selecting && !loading && original !== null && (source || name.trim()),
  )

  const chooseDirectory = useCallback(
    async (path?: string) => {
      if (project || actionPending.current) return
      actionPending.current = true
      const request = ++selectionVersion.current
      setSelecting(true)
      setError('')
      try {
        const value = path ?? (await selectProjectDirectory('添加源文件夹'))
        if (value) {
          const directory = await resolveProjectDirectory(value)
          const instructions = await readInstructions(directory)
          if (request !== selectionVersion.current) return
          setSource(directory)
          setOriginal(instructions.content)
          setContent((draft) => instructions.content || draft)
        }
      } catch (reason) {
        if (request === selectionVersion.current) setError(String(reason))
      } finally {
        if (request === selectionVersion.current) {
          actionPending.current = false
          setSelecting(false)
        }
      }
    },
    [project],
  )

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
        void chooseDirectory(event.paths[0])
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
  }, [open, project, desktop, chooseDirectory])

  useEffect(() => {
    if (!project) return
    let disposed = false
    readInstructions(project.path).then(
      (value) => {
        if (!disposed) {
          setContent(value.content)
          setOriginal(value.content)
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
      const instructions =
        content !== original ? { instructions: content, expectedInstructions: original ?? '' } : {}
      if (project) {
        await useWorkspaceStore.getState().updateProject({
          path: project.path,
          name: name.trim() || null,
          ...instructions,
        })
      } else {
        await useWorkspaceStore.getState().addProject({
          sourcePath: source,
          name: name.trim() || null,
          ...instructions,
        })
      }
      onClose()
    } catch (reason) {
      setError(String(reason))
    } finally {
      actionPending.current = false
      setSaving(false)
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
        size="lg"
        className="max-h-[calc(100dvh-var(--titlebar-height)-3rem)] overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>{project ? '编辑项目' : '新建项目'}</DialogTitle>
          <DialogDescription>
            {project
              ? '修改项目名称和指令，源文件夹保持原有位置。'
              : '填写项目名称，或添加源文件夹。未添加文件夹时，在设置的保存位置创建项目。'}
          </DialogDescription>
        </DialogHeader>
        <DialogForm
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogBody viewportClassName="max-h-[calc(100dvh-var(--titlebar-height)-18rem)]">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="project-name">项目名称</FieldLabel>
                <Input
                  id="project-name"
                  aria-label="项目名称"
                  aria-describedby={source ? 'project-name-hint' : undefined}
                  placeholder={sourceName || '项目名称'}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={saving || selecting || loading}
                  autoFocus
                />
                {source && (
                  <FieldDescription id="project-name-hint">
                    可留空，使用文件夹名称作为项目名。
                  </FieldDescription>
                )}
              </Field>
              <Field role="region" aria-label="源文件夹">
                <div className="flex items-center justify-between">
                  <FieldTitle role="heading" aria-level={3}>
                    源文件夹
                  </FieldTitle>
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
                  aria-label={project ? '项目源文件夹' : '源文件夹拖放区'}
                  className={`overflow-hidden rounded-lg border border-solid transition-colors ${dragging ? 'border-ring bg-muted/40' : ''}`}
                  onDragOver={(event) => {
                    if (
                      !project &&
                      !actionPending.current &&
                      event.dataTransfer.types.includes('Files')
                    ) {
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
                    if (project) return
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
                        {!project && (
                          <Button
                            aria-label="移除文件夹"
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-foreground"
                            disabled={saving || selecting}
                            onClick={() => {
                              setSource(null)
                              setOriginal('')
                              setError('')
                            }}
                          >
                            <X className="size-3.5" />
                          </Button>
                        )}
                      </div>
                      {!project && (
                        <div className="flex flex-wrap items-center justify-between gap-1 border-t px-2 py-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={saving || selecting}
                            onClick={() => void chooseDirectory()}
                          >
                            <FolderOpen className="stroke-[1.5]" />
                            更换文件夹
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-5">
                      <p className="mb-1 text-xs text-muted-foreground">
                        {dragging ? '松开以添加文件夹' : '拖拽文件夹到此处'}
                      </p>
                      <Button
                        variant="outline"
                        disabled={saving || selecting}
                        onClick={() => void chooseDirectory()}
                      >
                        <FolderPlus className="stroke-[1.5]" />
                        添加文件夹
                      </Button>
                    </div>
                  )}
                </div>
                {!source && (
                  <div className="space-y-1 text-xs leading-5 text-muted-foreground">
                    <p>未添加源文件夹时，将在以下位置新建项目，可在设置中修改</p>
                    <p className="break-all">{createDirectory}</p>
                  </div>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="project-instructions">项目指令</FieldLabel>
                <FieldDescription id="project-instructions-hint">
                  应用于此项目的所有会话。
                </FieldDescription>
                <Textarea
                  id="project-instructions"
                  aria-describedby="project-instructions-hint"
                  disabled={loading || saving || selecting || original === null}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  className="min-h-28 max-h-56"
                  placeholder={loading ? '正在读取项目指令…' : '例如：使用中文回答，遵循项目约定。'}
                />
              </Field>
              <FieldError>{error}</FieldError>
            </FieldGroup>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={saving || selecting} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saving ? (project ? '正在保存…' : '正在创建…') : project ? '保存修改' : '新建项目'}
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </WorkspaceDialog>
  )
}
