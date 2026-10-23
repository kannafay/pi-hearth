import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus } from 'lucide-react'
import { Tabs } from '@base-ui/react/tabs'
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
  const [mode, setMode] = useState('create')
  const [directory, setDirectory] = useState('')
  const [selecting, setSelecting] = useState(false)
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
    if (saving || selecting) return
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
          .addProject(mode === 'create' ? parent : directory, mode === 'create' ? name : null)
      }
      onClose()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function chooseDirectory() {
    if (selecting) return
    setSelecting(true)
    setError('')
    try {
      const value = await selectProjectDirectory(
        mode === 'create' ? '选择父文件夹' : '选择项目文件夹',
      )
      if (value) {
        if (mode === 'create') setParent(value)
        else setDirectory(value)
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
        className={`max-h-[calc(100dvh-var(--titlebar-height)-3rem)] overflow-hidden ${project ? 'sm:max-w-160' : ''}`}
      >
        <DialogHeader>
          <DialogTitle>{project ? `${project.name} · 项目指令` : '新建项目'}</DialogTitle>
          <DialogDescription>
            {project
              ? '保存到项目的指令文件，该项目的所有会话与 Pi CLI 均可使用。'
              : '新建一个文件夹，或选择已有文件夹作为项目。'}
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
                <Tabs.Root
                  value={mode}
                  onValueChange={(value) => setMode(String(value))}
                  className="space-y-4"
                >
                  <Tabs.List
                    aria-label="项目来源"
                    className="sidebar-tabs relative isolate grid h-9 grid-cols-2 rounded-lg p-0.5"
                  >
                    {(
                      [
                        ['create', '新建文件夹', FolderPlus],
                        ['existing', '选择已有文件夹', FolderOpen],
                      ] as const
                    ).map(([value, label, Icon]) => (
                      <Tabs.Tab
                        key={String(value)}
                        value={value}
                        disabled={saving || selecting}
                        className="relative z-10 flex items-center justify-center gap-2 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-foreground"
                      >
                        <Icon className="size-3.5 stroke-[1.5]" />
                        {label}
                      </Tabs.Tab>
                    ))}
                    <Tabs.Indicator className="sidebar-tab-indicator absolute top-(--active-tab-top) left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) rounded-md bg-sidebar-accent shadow-xs" />
                  </Tabs.List>
                  <Tabs.Panel value={mode} className="space-y-4 outline-none">
                    {mode === 'create' && (
                      <div className="space-y-2">
                        <label htmlFor="project-name">项目名称</label>
                        <Input
                          id="project-name"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          disabled={saving}
                          autoFocus
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <label htmlFor="project-directory">
                        {mode === 'create' ? '父文件夹' : '项目文件夹'}
                      </label>
                      <div className="flex gap-2">
                        <Input
                          id="project-directory"
                          value={mode === 'create' ? parent : directory}
                          disabled={saving || selecting}
                          onChange={(event) => {
                            if (mode === 'create') setParent(event.target.value)
                            else setDirectory(event.target.value)
                          }}
                        />
                        <Button
                          variant="outline"
                          disabled={saving || selecting}
                          onClick={() => void chooseDirectory()}
                        >
                          选择文件夹
                        </Button>
                      </div>
                    </div>
                  </Tabs.Panel>
                </Tabs.Root>
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
          <Button variant="outline" disabled={saving || selecting} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={
              saving ||
              selecting ||
              loading ||
              (!project && (mode === 'create' ? !name.trim() || !parent.trim() : !directory.trim()))
            }
            onClick={() => void submit()}
          >
            {saving ? '正在保存…' : project ? '保存指令' : '开始对话'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  )
}
