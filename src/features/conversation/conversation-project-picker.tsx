import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronUp, Folder, FolderPlus, MessageSquare, Search } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { menuItemStyles, menuPopupStyles } from '@/components/ui/menu-styles'
import { ScrollArea } from '@/components/scroll-area'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import { sessionKey } from '@/lib/session-preferences'

type ProjectOption = { name: string; path: string | null }

export function ConversationProjectPicker({
  disabled = false,
  onCreateProject,
}: {
  disabled?: boolean
  onCreateProject?: () => void
}) {
  const { projects, projectPath, newConversation } = useWorkspaceStore(
    useShallow((state) => ({
      projects: state.projects,
      projectPath: state.projectPath,
      newConversation: state.newConversation,
    })),
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const items = useMemo<ProjectOption[]>(
    () => [{ name: '不使用项目', path: null }, ...projects],
    [projects],
  )
  const selected = items.find((item) => sessionKey(item.path) === sessionKey(projectPath))
  const name = selected?.path ? selected.name : projectPath?.split(/[\\/]/).filter(Boolean).at(-1)
  const enabled = !disabled && isDesktop()
  if (!enabled && open) setOpen(false)

  return (
    <Combobox.Root
      items={items}
      value={selected ?? null}
      isItemEqualToValue={(item, value) => sessionKey(item.path) === sessionKey(value.path)}
      itemToStringLabel={(item) => item.name}
      filter={(item, term) => {
        const text = `${item.name} ${item.path ?? ''}`.replaceAll('\\', '/').toLowerCase()
        return term
          .trim()
          .replaceAll('\\', '/')
          .toLowerCase()
          .split(/\s+/)
          .every((word) => text.includes(word))
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      open={enabled && open}
      onOpenChange={(next) => {
        if (next) setQuery('')
        setOpen(next)
      }}
      onOpenChangeComplete={(next) => {
        if (!next) setQuery('')
      }}
      onValueChange={(item) => {
        if (item) void newConversation(item.path, { preserveDraft: true })
      }}
      disabled={!enabled}
      autoHighlight
    >
      <Combobox.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="选择对话项目"
            className="h-7 max-w-full gap-2 px-2 text-xs font-normal text-muted-foreground hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent"
          />
        }
      >
        <Folder aria-hidden className="size-3.5 shrink-0 stroke-[1.5]" />
        <span className="min-w-0 truncate">{name ?? '选择项目（可选）'}</span>
        <ChevronUp
          aria-hidden
          className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner side="top" align="start" sideOffset={8} className="isolate z-50">
          <Combobox.Popup
            data-project-picker-popup
            initialFocus
            finalFocus={enabled}
            className={cn(
              menuPopupStyles,
              'project-picker-popup flex w-80 max-w-[calc(100vw-3rem)] flex-col overflow-hidden',
            )}
          >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-3">
              <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <Combobox.Input
                aria-label="搜索项目名称或路径"
                placeholder="搜索项目名称或路径…"
                maxLength={200}
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ScrollArea
              data-project-picker-list
              className="min-h-0 flex-1"
              viewportClassName="overflow-x-hidden overflow-y-auto p-1"
              style={{ maxHeight: 'min(16rem, max(0px, calc(var(--available-height) - 5rem)))' }}
            >
              <Combobox.List aria-label="项目列表" className="space-y-0.5">
                {(item: ProjectOption) => {
                  const Icon = item.path ? Folder : MessageSquare
                  return (
                    <Combobox.Item
                      key={item.path ?? 'general'}
                      value={item}
                      aria-label={item.path ? `${item.name} ${item.path}` : item.name}
                      className={cn(menuItemStyles, 'min-h-8 gap-2 px-2 py-1.5 pr-8')}
                    >
                      <Icon
                        aria-hidden
                        className="size-4 shrink-0 stroke-[1.5] text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[13px] leading-5">{item.name}</span>
                        {item.path && (
                          <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                            {item.path}
                          </span>
                        )}
                      </span>
                      <Combobox.ItemIndicator className="absolute right-2">
                        <Check className="size-3.5" />
                      </Combobox.ItemIndicator>
                    </Combobox.Item>
                  )
                }}
              </Combobox.List>
              <Combobox.Empty>
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  没有匹配的项目
                </p>
              </Combobox.Empty>
            </ScrollArea>
            <div className="shrink-0 border-t border-border/70 p-1">
              <Button
                variant="ghost"
                disabled={!onCreateProject}
                className="h-8 w-full justify-start gap-2 rounded-md px-2 text-[13px] font-normal"
                onClick={() => {
                  setOpen(false)
                  onCreateProject?.()
                }}
              >
                <FolderPlus className="size-4 stroke-[1.5]" />
                新建项目
              </Button>
            </div>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
