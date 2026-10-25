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
import { resolveFilesDirectory } from '@/lib/file-directory'
import { SettingsRow } from './settings-row'
import { FieldDescription, FieldError } from '@/components/ui/field'

const locations = [
  { value: 'default', label: '默认目录', icon: Folder },
  { value: 'custom', label: '自定义目录', icon: FolderCog },
]

export function StorageLocationSettings({ kind }: { kind: 'projects' | 'files' }) {
  const files = kind === 'files'
  const title = files ? '文件保存位置' : '新项目保存位置'
  const id = files ? 'file-location' : 'project-location'
  const directory = useWorkspaceStore((state) =>
    files ? state.filesDirectory : state.projectsDirectory,
  )
  const customDirectory = useWorkspaceStore((state) =>
    files
      ? state.customFilesDirectory || state.filesDirectory
      : state.customProjectsDirectory || state.projectsDirectory,
  )
  const [defaultDirectory, setDefaultDirectory] = useState(
    files ? '文档\\Pi Hearth\\Files' : '文档\\Pi Hearth\\Projects',
  )
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState('')
  const desktop = isDesktop()
  const { label: locationLabel, icon: LocationIcon } = locations[directory ? 1 : 0]
  const displayedDirectory = directory || defaultDirectory

  useEffect(() => {
    if (!desktop) return
    let disposed = false
    const resolved = files ? resolveFilesDirectory() : resolveProjectDirectory()
    void resolved.then(
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
  }, [desktop, files])

  function setDirectory(path: string) {
    const store = useWorkspaceStore.getState()
    if (files) store.setFilesDirectory(path)
    else store.setProjectsDirectory(path)
  }

  async function chooseDirectory() {
    if (selecting) return
    setSelecting(true)
    setError('')
    try {
      const selected = await selectProjectDirectory(title)
      if (selected) {
        const path = files
          ? await resolveFilesDirectory(selected)
          : await resolveProjectDirectory(selected)
        setDirectory(path)
      }
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSelecting(false)
    }
  }

  return (
    <SettingsRow
      title={title}
      description={
        files
          ? '保存上传附件和独立生成的文件，与项目保存位置独立设置。'
          : '未添加源文件夹时，在此目录下创建项目文件夹。'
      }
      htmlFor={id}
      descriptionId={`${id}-description`}
      control={
        <Select
          items={locations}
          value={directory ? 'custom' : 'default'}
          disabled={!desktop || selecting}
          onValueChange={(value) => {
            if (value === 'default') setDirectory('')
            else if (value === 'custom') {
              if (customDirectory) setDirectory(customDirectory)
              else void chooseDirectory()
            }
          }}
        >
          <SelectTrigger
            id={id}
            aria-label={title}
            aria-describedby={`${id}-description`}
            className="w-36"
          >
            <SelectValue className="min-w-0">
              <LocationIcon aria-hidden className="size-3.5 stroke-[1.6]" />
              <span className="truncate">{locationLabel}</span>
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
      }
    >
      <div className="flex h-7 items-center gap-3">
        <FieldDescription className="min-w-0 flex-1 truncate" title={displayedDirectory}>
          {displayedDirectory}
        </FieldDescription>
        {directory && (
          <Button
            variant="outline"
            size="sm"
            aria-label={files ? '更改文件目录' : '更改项目目录'}
            disabled={!desktop || selecting}
            onClick={() => void chooseDirectory()}
          >
            <FolderOpen aria-hidden data-icon="inline-start" />
            更改目录
          </Button>
        )}
      </div>
      {files && <FieldDescription>更改位置仅影响新文件，已有文件保留在原位置。</FieldDescription>}
      {selecting && (
        <p role="status" className="text-xs text-muted-foreground">
          正在选择目录…
        </p>
      )}
      <FieldError>{error}</FieldError>
    </SettingsRow>
  )
}
