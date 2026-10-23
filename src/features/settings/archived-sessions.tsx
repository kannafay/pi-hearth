import { useLayoutEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore, Folder, Trash2 } from 'lucide-react'
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
import type { ProjectInfo, SessionInfo } from '@/lib/generated/pi'
import { hasPath, orderedProjects } from '@/lib/navigation-order'
import { ProjectDeleteDialog } from '@/features/workspace/project-delete-dialog'
import { SettingsPageHeader } from './settings-page-header'

function ArchivedSessionTitle({ title }: { title: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [truncated, setTruncated] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [title])

  return (
    <Tooltip disabled={!truncated}>
      <TooltipTrigger
        tabIndex={truncated ? 0 : undefined}
        render={<p ref={ref} className="truncate text-[13px] leading-5" />}
      >
        {title}
      </TooltipTrigger>
      <TooltipContent
        role="tooltip"
        showArrow={false}
        align="start"
        className="max-w-80 leading-5 wrap-anywhere"
      >
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

export function ArchivedSessions() {
  const {
    sessions,
    sessionPreferences,
    sessionActionPending,
    setSessionArchived,
    deleteArchivedSessions,
    projects,
    projectOrder,
    pinnedProjects,
    archivedProjects,
    setProjectArchived,
  } = useWorkspaceStore()
  const [error, setError] = useState('')
  const [deleteProject, setDeleteProject] = useState<ProjectInfo | null>(null)
  const archivedProjectList = orderedProjects(projects, projectOrder, pinnedProjects).filter(
    (project) => hasPath(archivedProjects, project.path),
  )
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
        description="归档的项目和聊天会保留在本机，可随时恢复。"
        className="pb-4"
      />
      {error && (
        <p role="alert" className="pt-4 text-xs text-destructive">
          {error}
        </p>
      )}
      {archivedProjectList.length > 0 && (
        <section aria-label="归档项目" className="border-b py-4">
          <h3 className="mb-2 text-xs text-muted-foreground">项目</h3>
          <ul className="divide-y">
            {archivedProjectList.map((project) => (
              <li key={project.path} className="flex min-w-0 items-center gap-2.5 py-2">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">{project.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {project.path}
                  </p>
                </div>
                <IconButton
                  label={`恢复项目 ${project.name}`}
                  title="恢复项目"
                  size="icon-sm"
                  disabled={!desktop || busy}
                  className="text-muted-foreground"
                  onClick={() => void setProjectArchived(project, false)}
                >
                  <ArchiveRestore className="size-3.5" />
                </IconButton>
                <IconButton
                  label={`删除项目 ${project.name}`}
                  title="删除项目"
                  size="icon-sm"
                  disabled={!desktop || busy}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteProject(project)}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      {archivedProjectList.length > 0 && archived.length > 0 && (
        <h3 className="mt-4 text-xs text-muted-foreground">会话</h3>
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
            <span className="flex min-h-7 flex-1 items-center text-xs text-muted-foreground">
              {chosen.length ? `已选 ${chosen.length} 项` : `共 ${archived.length} 个会话`}
            </span>
            {chosen.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  disabled={!desktop || busy}
                  onClick={() => void restore(chosen)}
                >
                  <ArchiveRestore className="size-3.5" />
                  恢复所选
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15"
                  disabled={!desktop || busy}
                  onClick={() => setDeleteTargets(chosen)}
                >
                  <Trash2 className="size-3.5" />
                  删除所选
                </Button>
              </>
            )}
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
                    <ArchivedSessionTitle title={session.title} />
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
      ) : !archivedProjectList.length ? (
        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
          <Archive aria-hidden className="size-6 stroke-[1.5] opacity-60" />
          <p className="text-sm">暂无归档会话</p>
        </div>
      ) : null}
      <ProjectDeleteDialog project={deleteProject} onClose={() => setDeleteProject(null)} />
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
