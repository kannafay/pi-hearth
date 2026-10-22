import { useState } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { isDesktop } from '@/lib/desktop'
import { sessionPreference } from '@/lib/session-preferences'
import type { SessionInfo } from '@/lib/generated/pi'
import { SettingsPageHeader } from './settings-page-header'

export function ArchivedSessions() {
  const { sessions, sessionPreferences, sessionActionPending, setSessionArchived, projects } =
    useWorkspaceStore()
  const [error, setError] = useState('')
  const archived = sessions
    .filter((session) => sessionPreference(sessionPreferences, session.path).archived)
    .sort((a, b) => b.modified - a.modified)

  async function restore(session: SessionInfo) {
    setError('')
    if (!(await setSessionArchived(session, false))) {
      setError(useWorkspaceStore.getState().error ?? '未能恢复会话，请重试。')
    }
  }

  return (
    <>
      <SettingsPageHeader title="归档" description="归档的聊天会保留在本机，可随时恢复。" />
      {error && (
        <p role="alert" className="pt-4 text-xs text-destructive">
          {error}
        </p>
      )}
      {archived.length ? (
        <ul className="divide-y border-b">
          {archived.map((session) => {
            const project = projects.find(
              (project) =>
                project.path.replaceAll('\\', '/').toLowerCase() ===
                session.cwd.replaceAll('\\', '/').toLowerCase(),
            )
            return (
              <li key={session.path} className="flex items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6 wrap-anywhere">{session.title}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {project?.name ?? '聊天'} ·{' '}
                    {new Date(session.modified).toLocaleDateString('zh-CN')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`恢复 ${session.title}`}
                  disabled={!isDesktop() || Boolean(sessionActionPending)}
                  onClick={() => void restore(session)}
                >
                  <ArchiveRestore className="size-3.5" />
                  恢复
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
          <Archive aria-hidden className="size-6 stroke-[1.5] opacity-60" />
          <p className="text-sm">暂无归档会话</p>
        </div>
      )}
    </>
  )
}
