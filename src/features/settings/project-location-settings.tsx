import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isDesktop, selectProjectDirectory } from '@/lib/desktop'
import { resolveProjectDirectory } from '@/lib/project-directory'

const locations = [
  { value: 'default', label: '默认目录' },
  { value: 'custom', label: '自定义目录' },
]

export function ProjectLocationSettings() {
  const directory = useWorkspaceStore((state) => state.projectsDirectory)
  const [defaultDirectory, setDefaultDirectory] = useState('文档\\Pi Hearth\\Projects')
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState('')
  const desktop = isDesktop()

  useEffect(() => {
    if (!desktop) return
    let disposed = false
    void resolveProjectDirectory().then(
      (path) => {
        if (!disposed) setDefaultDirectory(path)
      },
      (reason: unknown) => {
        if (!disposed) setError(String(reason))
      },
    )
    return () => {
      disposed = true
    }
  }, [desktop])

  async function chooseDirectory() {
    if (selecting) return
    setSelecting(true)
    setError('')
    try {
      const selected = await selectProjectDirectory('新项目保存位置')
      if (selected) {
        const path = await resolveProjectDirectory(selected)
        useWorkspaceStore.getState().setProjectsDirectory(path)
      }
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSelecting(false)
    }
  }

  return (
    <div className="space-y-4 border-b py-5">
      <div className="flex items-center justify-between gap-5">
        <div>
          <h3 className="text-sm font-normal">新项目保存位置</h3>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            未添加源文件夹时，在此目录下创建项目文件夹。
          </p>
        </div>
        <Select
          items={locations}
          value={directory ? 'custom' : 'default'}
          disabled={!desktop || selecting}
          onValueChange={(value) => {
            if (value === 'default') useWorkspaceStore.getState().setProjectsDirectory('')
            else if (value === 'custom') void chooseDirectory()
          }}
        >
          <SelectTrigger aria-label="新项目保存位置" className="w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {locations.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-xs leading-5 text-muted-foreground break-all">
          {directory || defaultDirectory}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={!desktop || selecting}
          onClick={() => void chooseDirectory()}
        >
          <FolderOpen className="stroke-[1.5]" />
          {selecting ? '正在选择…' : '选择目录'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
