import { useEffect, useState } from 'react'
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
  const [parent, setParent] = useState('')
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [file, setFile] = useState('')
  const [loading, setLoading] = useState(Boolean(project))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
    setSaving(true)
    setError('')
    try {
      if (project) {
        await saveInstructions(project.path, content, original)
        if (useWorkspaceStore.getState().projectPath === project.path)
          await useWorkspaceStore.getState().reloadCurrent()
      } else {
        await useWorkspaceStore.getState().addProject(parent, name)
      }
      onClose()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <WorkspaceDialog
      open={open}
      onOpenChangeComplete={onOpenChangeComplete}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent
        className={`max-h-[calc(100dvh-var(--titlebar-height)-3rem)] overflow-hidden ${project ? 'sm:max-w-160' : ''}`}
      >
        <DialogHeader>
          <DialogTitle>{project ? `${project.name} · 项目指令` : '创建项目'}</DialogTitle>
          <DialogDescription>
            {project
              ? '保存到项目的指令文件，该项目的所有会话与 Pi CLI 均可使用。'
              : '选择父文件夹并输入名称，创建新的本地项目。'}
          </DialogDescription>
        </DialogHeader>
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
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="project-name">项目名称</label>
                  <Input
                    id="project-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="project-parent">父文件夹</label>
                  <div className="flex gap-2">
                    <Input
                      id="project-parent"
                      value={parent}
                      onChange={(event) => setParent(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        void selectProjectDirectory('选择父文件夹')
                          .then((value) => {
                            if (value) setParent(value)
                          })
                          .catch((reason: unknown) => setError(String(reason)))
                      }}
                    >
                      选择文件夹
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={saving || loading || (!project && (!name.trim() || !parent.trim()))}
            onClick={() => void submit()}
          >
            {saving ? '正在保存…' : project ? '保存指令' : '创建项目'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  )
}
