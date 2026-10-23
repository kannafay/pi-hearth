import { useEffect, useState } from 'react'
import { Folder, FolderCog, FolderOpen } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isDesktop, selectProjectDirectory } from '@/lib/desktop'
import { resolveProjectDirectory } from '@/lib/project-directory'

const locations = [
  { value: 'default', label: '默认目录', icon: Folder },
  { value: 'custom', label: '自定义目录', icon: FolderCog },
]

export function ProjectLocationSettings() {
  const directory = useWorkspaceStore((state) => state.projectsDirectory)
  const [defaultDirectory, setDefaultDirectory] = useState('文档\\Pi Hearth\\Projects')
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState('')
  const desktop = isDesktop()
  const { label: locationLabel, icon: LocationIcon } = locations[directory ? 1 : 0]

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
        <div className="min-w-0">
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
            <SelectValue>
              <LocationIcon aria-hidden className="size-3.5 stroke-[1.6]" />
              <span>{locationLabel}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {locations.map(({ value, label, icon: Icon }) => (
                <SelectItem key={value} value={value}>
                  <Icon aria-hidden className="size-3.5 self-center stroke-[1.6]" />
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground break-all">
          {directory || defaultDirectory}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
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
