import { useCallback, useEffect, useState } from 'react'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import { loadResourceCatalog } from '@/lib/resources'
import type { ResourceCatalog } from '@/lib/generated/pi'

export interface ResourceCatalogState {
  catalog: ResourceCatalog | null
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useResourceCatalog(open: boolean, active: boolean): ResourceCatalogState {
  const projectPath = useWorkspaceStore((state) => state.projectPath)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    projectPath: string | null
    revision: number
    catalog: ResourceCatalog | null
    error: string | null
  } | null>(null)
  const desktop = isDesktop()
  const refresh = useCallback(() => {
    setRevision((value) => value + 1)
  }, [])
  const current = result?.projectPath === projectPath && result.revision === revision

  useEffect(() => {
    if (!open || !active || !desktop || current) return
    let disposed = false
    loadResourceCatalog(projectPath).then(
      (catalog) => {
        if (disposed) return
        setResult({ projectPath, revision, catalog, error: null })
      },
      (reason) => {
        if (!disposed) setResult({ projectPath, revision, catalog: null, error: String(reason) })
      },
    )
    return () => {
      disposed = true
    }
  }, [open, active, projectPath, revision, desktop, current])

  return {
    catalog: result?.projectPath === projectPath ? result.catalog : null,
    loading: open && active && desktop && !current,
    error: !desktop ? '请在桌面应用中查看本机资源。' : current ? result.error : null,
    refresh,
  }
}
