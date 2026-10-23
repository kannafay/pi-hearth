import { useEffect, useState } from 'react'
import { Folder, FolderCog } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
import { SettingsRow } from './settings-row'
import { FieldDescription, FieldError } from '@/components/ui/field'

const locations = [
  { value: 'default', label: '默认目录', icon: Folder },
  { value: 'custom', label: '自定义目录', icon: FolderCog },
]

export function ProjectLocationSettings() {
  const directory = useWorkspaceStore((state) => state.projectsDirectory)
  const customDirectory = useWorkspaceStore(
    (state) => state.customProjectsDirectory || state.projectsDirectory,
  )
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
    <SettingsRow
      title="新项目保存位置"
      description="未添加源文件夹时，在此目录下创建项目文件夹。"
      htmlFor="project-location"
      descriptionId="project-location-description"
      control={
        <Select
          items={locations}
          value={directory ? 'custom' : 'default'}
          disabled={!desktop || selecting}
          onValueChange={(value) => {
            if (value === 'default') useWorkspaceStore.getState().setProjectsDirectory('')
            else if (value === 'custom') {
              if (customDirectory)
                useWorkspaceStore.getState().setProjectsDirectory(customDirectory)
              else void chooseDirectory()
            }
          }}
        >
          <SelectTrigger
            id="project-location"
            aria-label="新项目保存位置"
            aria-describedby="project-location-description"
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
      {directory ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="link"
                className="h-auto max-w-full justify-start rounded-sm border-0 p-0 text-left text-xs leading-5 font-normal whitespace-normal text-muted-foreground hover:text-foreground"
              />
            }
            aria-label="更改自定义目录"
            disabled={!desktop || selecting}
            onClick={() => void chooseDirectory()}
          >
            <span className="min-w-0 break-all">{directory}</span>
          </TooltipTrigger>
          <TooltipContent showArrow={false}>点击更改自定义目录</TooltipContent>
        </Tooltip>
      ) : (
        <FieldDescription className="break-all">{defaultDirectory}</FieldDescription>
      )}
      {selecting && (
        <p role="status" className="text-xs text-muted-foreground">
          正在选择目录…
        </p>
      )}
      <FieldError>{error}</FieldError>
    </SettingsRow>
  )
}
