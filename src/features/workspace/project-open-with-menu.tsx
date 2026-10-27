import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { ApplicationIcon } from '@/components/application-icon'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { openDirectoryWith, type DirectoryApplication } from '@/lib/desktop'
import { toast } from '@/lib/toast'

const applications: { value: DirectoryApplication; label: string }[] = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'explorer', label: '资源管理器' },
  { value: 'terminal', label: 'Windows 终端' },
]

export function ProjectOpenWithMenu({ path, disabled }: { path: string; disabled: boolean }) {
  const [opening, setOpening] = useState(false)

  async function open(application: DirectoryApplication) {
    if (disabled || opening) return
    setOpening(true)
    try {
      await openDirectoryWith(path, application)
    } catch (reason) {
      toast.error(reason)
    } finally {
      setOpening(false)
    }
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled || opening}>
        <FolderOpen className="size-3.5" />
        打开方式
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-40">
        {applications.map(({ value, label }) => (
          <DropdownMenuItem key={value} disabled={opening} onClick={() => void open(value)}>
            <ApplicationIcon application={value} />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
