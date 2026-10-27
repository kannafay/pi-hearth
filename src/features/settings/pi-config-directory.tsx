import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { getPiConfigDirectory, isDesktop, openPiConfigDirectory } from '@/lib/desktop'
import { toast } from '@/lib/toast'
import { SettingsRow } from './settings-row'

export function PiConfigDirectory() {
  const desktop = isDesktop()
  const [directory, setDirectory] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!desktop) return
    let disposed = false
    getPiConfigDirectory().then(
      (path) => {
        if (!disposed) setDirectory(path)
      },
      (reason: unknown) => {
        if (!disposed) setError(String(reason))
      },
    )
    return () => {
      disposed = true
    }
  }, [desktop])

  async function open() {
    if (!desktop || !directory || opening) return
    setOpening(true)
    try {
      setDirectory(await openPiConfigDirectory())
    } catch (reason) {
      toast.error(reason)
    } finally {
      setOpening(false)
    }
  }

  return (
    <SettingsRow
      title="Pi CLI 配置目录"
      description={
        directory ? (
          <Button
            variant="link"
            aria-label="打开 Pi CLI 配置目录"
            title={directory}
            disabled={opening}
            className="h-auto max-w-full justify-start gap-2 rounded-sm border-0 p-0 text-left text-xs font-normal whitespace-normal text-muted-foreground hover:text-foreground"
            onClick={() => void open()}
          >
            <FolderOpen aria-hidden className="size-4" />
            <span className="min-w-0 break-all">{directory}</span>
          </Button>
        ) : error ? (
          <span>无法读取配置目录。</span>
        ) : desktop ? (
          '正在读取配置目录…'
        ) : (
          '请在桌面应用中查看。'
        )
      }
    >
      <FieldError>{error}</FieldError>
    </SettingsRow>
  )
}
