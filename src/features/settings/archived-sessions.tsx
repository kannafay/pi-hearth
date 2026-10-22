import { useState } from 'react'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/icon-button'
import { useDialogPresence } from '@/components/use-dialog-presence'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isDesktop } from '@/lib/desktop'
import { sessionPreference } from '@/lib/session-preferences'
import type { SessionInfo } from '@/lib/generated/pi'
import { SettingsPageHeader } from './settings-page-header'

export function ArchivedSessions() {
  const {
    sessions,
    sessionPreferences,
    sessionActionPending,
    setSessionArchived,
    deleteArchivedSessions,
    projects,
  } = useWorkspaceStore()
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(new Set<string>())
  const [deleteTargets, setDeleteTargets] = useState<SessionInfo[]>([])
  const deletePresence = useDialogPresence(deleteTargets.length ? deleteTargets : null)
  const shownTargets = deletePresence.value ?? []
  const [working, setWorking] = useState(false)
  const busy = working || Boolean(sessionActionPending)
  const desktop = isDesktop()
  const archived = sessions
    .filter((session) => sessionPreference(sessionPreferences, session.path).archived)
    .sort((a, b) => b.modified - a.modified)
  const chosen = archived.filter((session) => selected.has(session.path))
  const allSelected = archived.length > 0 && chosen.length === archived.length

  function deselect(paths: string[]) {
    setSelected((current) => {
      const next = new Set(current)
      paths.forEach((path) => next.delete(path))
      return next
    })
  }

  async function restore(targets: SessionInfo[]) {
    setError('')
    setWorking(true)
    try {
      let failure = ''
      for (const session of targets) {
        if (await setSessionArchived(session, false)) deselect([session.path])
        else failure = useWorkspaceStore.getState().error ?? '未能恢复会话，请重试。'
      }
      setError(failure)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setWorking(false)
    }
  }

  async function remove() {
    setError('')
    setWorking(true)
    try {
      const paths = deleteTargets.map((session) => session.path)
      if (await deleteArchivedSessions(paths)) deselect(paths)
      else setError(useWorkspaceStore.getState().error ?? '未能删除会话，请重试。')
      setDeleteTargets([])
    } catch (reason) {
      setError(String(reason))
      setDeleteTargets([])
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <SettingsPageHeader
        title="归档"
        description="归档的聊天会保留在本机，可随时恢复。"
        className="pb-4"
      />
      {error && (
        <p role="alert" className="pt-4 text-xs text-destructive">
          {error}
        </p>
      )}
      {archived.length ? (
        <>
          <div className="flex min-h-10 items-center gap-2 border-b py-1.5">
            <Checkbox
              aria-label="全选归档会话"
              checked={allSelected}
              indeterminate={chosen.length > 0 && !allSelected}
              disabled={!desktop || busy}
              onCheckedChange={(checked) =>
                setSelected(new Set(checked ? archived.map((session) => session.path) : []))
              }
            />
            <span className="flex-1 text-xs text-muted-foreground">
              {chosen.length ? `已选 ${chosen.length} 项` : `共 ${archived.length} 个会话`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              disabled={!desktop || busy || !chosen.length}
              onClick={() => void restore(chosen)}
            >
              <ArchiveRestore className="size-3.5" />
              恢复所选
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15"
              disabled={!desktop || busy || !chosen.length}
              onClick={() => setDeleteTargets(chosen)}
            >
              <Trash2 className="size-3.5" />
              删除所选
            </Button>
          </div>
          <ul aria-label="归档会话" className="divide-y border-b">
            {archived.map((session) => {
              const project = projects.find(
                (project) =>
                  project.path.replaceAll('\\', '/').toLowerCase() ===
                  session.cwd.replaceAll('\\', '/').toLowerCase(),
              )
              return (
                <li key={session.path} className="flex min-w-0 items-center gap-2.5 py-2">
                  <Checkbox
                    aria-label={`选择 ${session.title}`}
                    checked={selected.has(session.path)}
                    disabled={!desktop || busy}
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current)
                        if (checked) next.add(session.path)
                        else next.delete(session.path)
                        return next
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <Tooltip>
                      <TooltipTrigger render={<p className="truncate text-[13px] leading-5" />}>
                        {session.title}
                      </TooltipTrigger>
                      <TooltipContent showArrow={false} className="max-w-80 wrap-anywhere">
                        {session.title}
                      </TooltipContent>
                    </Tooltip>
                    <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
                      {project?.name ?? '聊天'} ·{' '}
                      {new Date(session.modified).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton
                      label={`恢复 ${session.title}`}
                      title="恢复"
                      size="icon-sm"
                      disabled={!desktop || busy}
                      className="text-muted-foreground"
                      onClick={() => void restore([session])}
                    >
                      <ArchiveRestore className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={`删除 ${session.title}`}
                      title="删除"
                      size="icon-sm"
                      disabled={!desktop || busy}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15"
                      onClick={() => setDeleteTargets([session])}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
          <Archive aria-hidden className="size-6 stroke-[1.5] opacity-60" />
          <p className="text-sm">暂无归档会话</p>
        </div>
      )}
      <Dialog
        open={deleteTargets.length > 0}
        onOpenChangeComplete={deletePresence.onOpenChangeComplete}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTargets([])
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-100">
          <DialogTitle>删除 {shownTargets.length} 个归档会话？</DialogTitle>
          <DialogDescription>聊天记录会从本机删除，无法恢复。</DialogDescription>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {shownTargets.slice(0, 3).map((session) => (
              <li key={session.path} className="truncate">
                {session.title}
              </li>
            ))}
            {shownTargets.length > 3 && <li>以及其余 {shownTargets.length - 3} 个会话</li>}
          </ul>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleteTargets([])}>
              取消
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              {working ? '正在删除…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
