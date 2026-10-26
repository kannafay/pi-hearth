import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import {
  loadResourceCatalog,
  openResource,
  setResourceEnabled,
  type ResourceKind,
} from '@/lib/resources'
import type { ResourceCatalog, ResourceInfo } from '@/lib/generated/pi'

export interface ResourceCatalogState {
  catalog: ResourceCatalog | null
  loading: boolean
  error: string | null
  refresh: () => void
  pending: string | null
  setEnabled: (kind: ResourceKind, item: ResourceInfo, enabled: boolean) => Promise<void>
  open: (kind: ResourceKind, item: ResourceInfo) => Promise<void>
}

export function useResourceCatalog(open: boolean, active: boolean): ResourceCatalogState {
  const projectPath = useWorkspaceStore((state) => state.projectPath)
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{
    projectPath: string | null
    error: string
  } | null>(null)
  const writing = useRef(false)
  const [result, setResult] = useState<{
    projectPath: string | null
    revision: number
    catalog: ResourceCatalog | null
    error: string | null
  } | null>(null)
  const desktop = isDesktop()
  const refresh = useCallback(() => {
    setActionError(null)
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
    error: !desktop
      ? '请在桌面应用中查看本机资源。'
      : actionError?.projectPath === projectPath
        ? actionError.error
        : current
          ? result.error
          : null,
    refresh,
    pending,
    async setEnabled(kind, item, enabled) {
      if (writing.current) return
      writing.current = true
      setPending(`${kind}:${item.source}:${item.name}`)
      setActionError(null)
      try {
        const catalog = await setResourceEnabled(kind, item, projectPath, enabled)
        setResult({ projectPath, revision, catalog, error: null })
      } catch (error) {
        setActionError({ projectPath, error: String(error) })
      } finally {
        writing.current = false
        setPending(null)
      }
    },
    async open(kind, item) {
      setActionError(null)
      try {
        await openResource(kind, item, projectPath)
      } catch (error) {
        setActionError({ projectPath, error: String(error) })
      }
    },
  }
}
