import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUpRight, LoaderCircle, MessageSquare, Search } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import { ScrollArea } from '@/components/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldError } from '@/components/ui/field'
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { WorkspaceDialog } from '@/components/workspace-dialog'
import { isDesktop } from '@/lib/desktop'
import { searchSessions } from '@/lib/workspace'
import type { SessionInfo, SessionSearchResult } from '@/lib/generated/pi'
import { sessionPreference, visibleSessions } from '@/lib/session-preferences'
import { hasPath } from '@/lib/navigation-order'

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return text
  const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return text.split(new RegExp(`(${pattern})`, 'giu')).map((part, index) =>
    terms.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
      <mark key={index} className="rounded-sm bg-amber-100 text-inherit dark:bg-amber-500/25">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

export function SessionSearchDialog({
  open = true,
  onClose,
  onOpenChangeComplete,
}: {
  open?: boolean
  onClose: () => void
  onOpenChangeComplete?: (open: boolean) => void
}) {
  const workspace = useWorkspaceStore()
  const status = useConversationStore((state) => state.status)
  const [query, setQuery] = useState('')
  const [response, setResponse] = useState<{
    query: string
    attempt: number
    results: SessionSearchResult[]
    error: string | null
  }>({ query: '', attempt: 0, results: [], error: null })
  const [active, setActive] = useState(0)
  const [retry, setRetry] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const desktop = isDesktop()
  const term = query.trim()
  const currentResponse = response.query === term && response.attempt === retry
  const loading = desktop && Boolean(term) && !currentResponse
  const error = currentResponse ? response.error : null
  const busy = status === 'running' || status === 'stopping'
  const recent: SessionSearchResult[] = visibleSessions(
    workspace.sessions,
    workspace.sessionPreferences,
  )
    .slice(0, 20)
    .map((session) => ({
      session,
      projectName:
        workspace.projects.find(
          (project) =>
            project.path.replaceAll('\\', '/').toLowerCase() ===
            session.cwd.replaceAll('\\', '/').toLowerCase(),
        )?.name ?? '聊天',
      snippet: '',
      matchedIn: 'recent',
    }))
  const shown = (term ? (currentResponse ? response.results : []) : recent).filter(
    (result) =>
      !sessionPreference(workspace.sessionPreferences, result.session.path).archived &&
      !hasPath(workspace.archivedProjects, result.session.cwd),
  )

  useEffect(() => {
    let current = true
    if (!open || !term || !desktop) return
    const timer = setTimeout(() => {
      void searchSessions(term)
        .then((found) => {
          if (current) {
            setResponse({ query: term, attempt: retry, results: found, error: null })
          }
        })
        .catch((reason: unknown) => {
          if (current) {
            setResponse({ query: term, attempt: retry, results: [], error: String(reason) })
          }
        })
    }, 180)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [open, term, desktop, retry])

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  function openSession(session: SessionInfo) {
    if (busy || !desktop) return
    onClose()
    void workspace.openSession(session)
  }

  return (
    <WorkspaceDialog
      open={open}
      onOpenChangeComplete={(open) => {
        if (!open) {
          setQuery('')
          setResponse({ query: '', attempt: 0, results: [], error: null })
          setActive(0)
          setRetry(0)
        }
        onOpenChangeComplete?.(open)
      }}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        initialFocus={input}
        layout="panel"
        size="search"
        className="h-[min(560px,calc(100dvh-112px))]"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || !shown.length || loading) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const offset = event.key === 'ArrowDown' ? 1 : -1
            setActive((index) => (index + offset + shown.length) % shown.length)
          } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
            event.preventDefault()
            if (shown[active]) openSession(shown[active].session)
          }
        }}
      >
        <DialogTitle className="sr-only">搜索会话</DialogTitle>
        <DialogDescription className="sr-only">
          搜索项目名称、会话标题与对话内容，使用上下方向键选择，回车打开。
        </DialogDescription>
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4 pr-13">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <Input
            variant="embedded"
            ref={input}
            role="combobox"
            aria-label="搜索项目、标题或对话内容"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={id}
            aria-activedescendant={shown[active] && !loading ? `${id}-${active}` : undefined}
            value={query}
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            placeholder="搜索项目、标题或对话内容…"
          />
          {loading && (
            <LoaderCircle
              aria-hidden
              className="size-4 shrink-0 animate-spin text-muted-foreground"
            />
          )}
        </div>
        <div role="status" className="shrink-0 px-4 pt-3 pb-1 text-xs text-muted-foreground">
          {loading
            ? '正在搜索本地会话…'
            : term
              ? `找到 ${shown.length}${shown.length === 40 ? '+' : ''} 个会话`
              : '最近会话'}
        </div>
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="h-full overflow-x-hidden overflow-y-auto p-1.5"
        >
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label="搜索结果"
            aria-busy={loading}
            className="space-y-0.5"
          >
            {!loading &&
              shown.map((result, index) => (
                <button
                  key={result.session.path}
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={active === index}
                  disabled={busy || !desktop}
                  onPointerMove={() => setActive(index)}
                  onClick={() => openSession(result.session)}
                  className="group flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left outline-none transition-colors duration-160 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-muted disabled:opacity-60"
                >
                  <MessageSquare
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] leading-5">
                      <Highlight text={result.session.title} query={term} />
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] leading-4 text-muted-foreground">
                      <span className="truncate">
                        <Highlight text={result.projectName} query={term} />
                      </span>
                      {term && (
                        <span className="shrink-0">
                          ·{' '}
                          {
                            { title: '会话标题', project: '项目名称', content: '对话内容' }[
                              result.matchedIn
                            ]
                          }
                        </span>
                      )}
                    </span>
                    {result.snippet && term && (
                      <span className="mt-1 line-clamp-1 block text-xs leading-5 text-muted-foreground">
                        <Highlight text={result.snippet} query={term} />
                      </span>
                    )}
                  </span>
                  <ArrowUpRight
                    aria-hidden
                    className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 group-aria-selected:opacity-100"
                  />
                </button>
              ))}
          </div>
          {loading && (
            <div className="px-3 py-9 text-center text-sm text-muted-foreground">
              正在查找匹配的对话
            </div>
          )}
          {error ? (
            <div className="px-3 py-6 text-center">
              <FieldError>{error}</FieldError>
              <Button
                variant="ghost"
                className="mt-3"
                onClick={() => setRetry((value) => value + 1)}
              >
                重试搜索
              </Button>
            </div>
          ) : (
            !loading &&
            !shown.length && (
              <div className="px-3 py-9 text-center text-sm text-muted-foreground">
                {!desktop
                  ? '请在桌面应用中搜索会话'
                  : term
                    ? '没有匹配的会话，试试其他关键词'
                    : '还没有会话，开始一段新聊天吧'}
              </div>
            )
          )}
        </ScrollArea>
        <div className="flex shrink-0 justify-between border-t px-4 py-2.5 text-[11px] text-muted-foreground">
          <span>{busy ? '当前任务结束后可以切换会话' : '↑ ↓ 选择 · Enter 打开'}</span>
          <span>Esc 关闭</span>
        </div>
      </DialogContent>
    </WorkspaceDialog>
  )
}
