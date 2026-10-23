import { useShallow } from 'zustand/react/shallow'
import { ChevronDown, Folder, FolderPlus, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import { sessionKey } from '@/lib/session-preferences'

export function ConversationProjectPicker({ onCreateProject }: { onCreateProject?: () => void }) {
  const { projects, projectPath, newConversation } = useWorkspaceStore(
    useShallow((state) => ({
      projects: state.projects,
      projectPath: state.projectPath,
      newConversation: state.newConversation,
    })),
  )
  const project = projects.find((item) => sessionKey(item.path) === sessionKey(projectPath))
  const name = project?.name ?? projectPath?.split(/[\\/]/).filter(Boolean).at(-1)

  return (
    <div className="mt-4 flex justify-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              disabled={!isDesktop()}
              aria-label="选择对话项目"
              className="max-w-72 gap-2 text-xs font-normal text-muted-foreground"
            />
          }
        >
          <Folder className="size-3.5 shrink-0 stroke-[1.5]" />
          <span className="truncate">{name ?? '选择项目（可选）'}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-72 max-w-[calc(100vw-3rem)]">
          <DropdownMenuRadioGroup
            value={sessionKey(projectPath) ?? ''}
            onValueChange={(value) => {
              const path = projects.find((item) => sessionKey(item.path) === value)?.path ?? null
              void newConversation(path, { preserveDraft: true })
            }}
          >
            <DropdownMenuRadioItem value="" closeOnClick>
              <MessageSquare />
              不使用项目
            </DropdownMenuRadioItem>
            {projects.length > 0 && <DropdownMenuSeparator />}
            <div className="max-h-64 overflow-y-auto">
              {projects.map((item) => (
                <DropdownMenuRadioItem
                  key={item.path}
                  value={sessionKey(item.path)!}
                  aria-label={`${item.name} ${item.path}`}
                  closeOnClick
                >
                  <Folder className="shrink-0" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {item.path}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </div>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!onCreateProject} onClick={onCreateProject}>
            <FolderPlus />
            新建项目
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
