import { useEffect, useState } from 'react'
import { Folder, FolderOpen, FolderPlus, Laptop, LoaderCircle, X } from 'lucide-react'
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
import { selectProjectDirectory } from '@/lib/desktop'
import { readInstructions, saveInstructions } from '@/lib/workspace'
import { useWorkspaceStore } from '@/app/store'
import type { ProjectInfo } from '@/lib/generated/pi'

type ProjectSource = { kind: 'create' | 'existing'; directory: string }

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
  const [source, setSource] = useState<ProjectSource | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [file, setFile] = useState('')
  const [loading, setLoading] = useState(Boolean(project))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const existing = source?.kind === 'existing'
  const sourceName = source?.directory.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const displayName = existing ? sourceName : name
  const canSubmit = Boolean(
    !saving && !selecting && !loading && (project || (source && (existing || name.trim()))),
  )

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
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      if (project) {
        await saveInstructions(project.path, content, original)
        if (useWorkspaceStore.getState().projectPath === project.path)
          await useWorkspaceStore.getState().reloadCurrent()
      } else if (source) {
        await useWorkspaceStore
          .getState()
          .addProject(source.directory, existing ? null : name.trim())
      }
      onClose()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function chooseDirectory(kind: ProjectSource['kind']) {
    if (saving || selecting) return
    setSelecting(true)
    setError('')
    try {
      const value = await selectProjectDirectory(
        kind === 'create' ? '选择父文件夹' : '选择项目文件夹',
      )
      if (value) {
        setSource({ kind, directory: value })
      }
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSelecting(false)
    }
  }

  return (
    <WorkspaceDialog
      open={open}
      onOpenChangeComplete={onOpenChangeComplete}
      onOpenChange={(open) => {
        if (!open && !saving && !selecting) onClose()
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
              : '新建一个文件夹，或选择已有文件夹作为项目。'}
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
                        aria-describedby={existing ? 'project-name-hint' : undefined}
                        placeholder="项目名称"
                        value={displayName}
                        onChange={(event) => setName(event.target.value)}
                        readOnly={existing}
                        disabled={saving || selecting}
                        className="h-10 rounded-xl pl-13"
                        autoFocus
                      />
                    </div>
                    {existing && (
                      <p id="project-name-hint" className="text-xs text-muted-foreground">
                        项目名称与所选文件夹名称一致。
                      </p>
                    )}
                  </div>
                  <section aria-label="源文件夹" className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">源文件夹</h3>
                      <span
                        role={selecting ? 'status' : undefined}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        {selecting ? (
                          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                        ) : (
                          <Laptop aria-hidden className="size-3.5 stroke-[1.5]" />
                        )}
                        {selecting ? '正在选择文件夹…' : '此电脑'}
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-xl border">
                      {source ? (
                        <>
                          <div className="flex items-start gap-3 p-3.5">
                            {existing ? (
                              <FolderOpen
                                aria-hidden
                                className="mt-0.5 size-4 shrink-0 stroke-[1.5] text-muted-foreground"
                              />
                            ) : (
                              <FolderPlus
                                aria-hidden
                                className="mt-0.5 size-4 shrink-0 stroke-[1.5] text-muted-foreground"
                              />
                            )}
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="break-all">{displayName.trim() || '新文件夹'}</p>
                              <p className="text-xs leading-5 text-muted-foreground break-all">
                                {existing ? source.directory : `创建位置：${source.directory}`}
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
                              onClick={() => void chooseDirectory(source.kind)}
                            >
                              <FolderOpen className="stroke-[1.5]" />
                              {existing ? '更换文件夹' : '更换位置'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-foreground"
                              disabled={saving || selecting}
                              onClick={() => void chooseDirectory(existing ? 'create' : 'existing')}
                            >
                              <FolderPlus className="stroke-[1.5]" />
                              {existing ? '新建文件夹' : '添加已有文件夹'}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-5">
                          <p className="mb-1 text-xs text-muted-foreground">
                            添加已有文件夹，或新建一个文件夹
                          </p>
                          <div className="flex flex-wrap justify-center gap-2">
                            <Button
                              variant="secondary"
                              className="rounded-full"
                              disabled={saving || selecting}
                              onClick={() => void chooseDirectory('existing')}
                            >
                              <FolderPlus className="stroke-[1.5]" />
                              添加文件夹
                            </Button>
                            <Button
                              variant="ghost"
                              className="rounded-full text-muted-foreground hover:text-foreground"
                              disabled={saving || selecting}
                              onClick={() => void chooseDirectory('create')}
                            >
                              新建文件夹
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
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
