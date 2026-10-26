import { BookOpen, File, LoaderCircle, Terminal } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/scroll-area'
import type { ComposerCompletion } from './use-composer-completion'

export function ComposerCompletionMenu({ completion }: { completion: ComposerCompletion }) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [completion.active, completion.open, completion.items.length])
  if (!completion.open) return null
  const title = completion.kind === 'file' ? '项目文件' : '快捷操作'
  const indexedItems = completion.items.map((item, index) => ({ item, index }))
  const groups = (
    completion.kind === 'file'
      ? [{ key: 'file', title: null, items: indexedItems }]
      : (['command', 'skill'] as const).map((kind) => ({
          key: kind,
          title: kind === 'command' ? '命令' : '技能',
          items: indexedItems.filter(({ item }) => item.kind === kind),
        }))
  ).filter((group) => group.items.length)
  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-lg overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 duration-100 motion-reduce:animate-none">
      <div className="flex h-9 items-center justify-between px-3 text-xs text-muted-foreground">
        <span>{title}</span>
        <span aria-hidden>↑ ↓ 选择 · Enter / Tab 补全 · Esc 关闭</span>
      </div>
      <ScrollArea viewportClassName="max-h-[min(288px,45dvh)] overflow-y-auto p-1 pt-0">
        <div
          ref={list}
          id={completion.id}
          role="listbox"
          aria-label={title}
          aria-busy={completion.loading}
        >
          {groups.map((group, groupIndex) => (
            <div
              key={group.key}
              role={group.title ? 'group' : undefined}
              aria-labelledby={group.title ? `${completion.id}-${group.key}-label` : undefined}
              className={groupIndex ? 'mt-2' : undefined}
            >
              {group.title && (
                <div
                  id={`${completion.id}-${group.key}-label`}
                  className="px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {group.title}
                </div>
              )}
              {group.items.map(({ item, index }) => {
                const Icon =
                  item.kind === 'skill' ? BookOpen : item.kind === 'file' ? File : Terminal
                return (
                  <button
                    key={item.value}
                    id={`${completion.id}-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={completion.active === index}
                    onPointerMove={() => completion.setActive(index)}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => completion.select(item)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors hover:bg-accent aria-selected:bg-accent ${item.kind === 'file' ? 'py-2' : 'py-1.5'}`}
                  >
                    <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2 text-[13px] leading-5">
                        {item.kind === 'command' && (
                          <span className="shrink-0 text-muted-foreground">/{item.value}</span>
                        )}
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.kind === 'file' && (
                        <span className="block truncate text-xs leading-5 text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          {!completion.items.length && !completion.loading && !completion.error && (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {completion.kind === 'file' ? '未找到匹配文件' : '未找到匹配命令'}
            </p>
          )}
        </div>
      </ScrollArea>
      {(completion.loading || completion.error) && (
        <div
          role="status"
          className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground"
        >
          {completion.loading ? (
            <>
              <LoaderCircle aria-hidden className="size-3 animate-spin" />
              {completion.kind === 'file' ? '搜索文件…' : '读取已启用技能…'}
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate">{completion.error}</span>
              <button
                onPointerDown={(event) => event.preventDefault()}
                onClick={completion.retry}
                className="shrink-0 rounded px-1.5 py-1 hover:bg-accent"
              >
                重试
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
