import { useEffect, useState } from 'react'
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { WorkspaceDialog } from '@/components/workspace-dialog'
import { ScrollArea } from '@/components/scroll-area'
import { getAttachmentPreview } from '@/lib/attachments'
import type { Attachment, AttachmentPreview } from '@/lib/generated/pi'

export function AttachmentPreviewDialog({
  file,
  onClose,
}: {
  file: Attachment
  onClose: () => void
}) {
  const [preview, setPreview] = useState<AttachmentPreview | null>(null)
  const [error, setError] = useState('')
  const kind = preview?.kind ?? file.kind
  const title =
    kind === 'image'
      ? '图片预览'
      : kind === 'video'
        ? '视频预览'
        : kind === 'audio'
          ? '音频预览'
          : file.name
  const media = kind === 'image' || kind === 'video'

  useEffect(() => {
    let disposed = false
    void getAttachmentPreview(file).then(
      (value) => {
        if (!disposed) setPreview(value)
      },
      (reason: unknown) => {
        if (!disposed) setError(String(reason))
      },
    )
    return () => {
      disposed = true
    }
  }, [file])

  return (
    <WorkspaceDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className={`max-h-[calc(100dvh-var(--titlebar-height)-3rem)] min-w-64 gap-4 overflow-hidden rounded-lg sm:max-w-[calc(100vw-3rem)] ${media ? 'w-fit max-w-[calc(100vw-3rem)]' : kind === 'audio' ? 'w-[min(420px,calc(100vw-3rem))]' : 'w-[min(720px,calc(100vw-3rem))]'}`}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape' && !document.fullscreenElement) {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <DialogTitle className="pr-8 text-sm">{title}</DialogTitle>
        <DialogDescription className="sr-only">查看附件内容。</DialogDescription>
        {error ? (
          <p role="alert" className="py-8 text-sm text-muted-foreground">
            {error}
          </p>
        ) : !preview ? (
          <p role="status" className="py-8 text-sm text-muted-foreground">
            正在读取附件…
          </p>
        ) : preview.kind === 'image' && preview.source ? (
          <div className="flex min-h-0 items-center justify-center">
            <img
              src={preview.source}
              alt="图片预览"
              className="block h-auto w-auto max-w-[min(80vw,960px)] max-h-[calc(100dvh-var(--titlebar-height)-9rem)] rounded-sm object-contain"
              onError={() => setError('图片无法显示。')}
            />
          </div>
        ) : preview.kind === 'video' && preview.source ? (
          <video
            src={preview.source}
            controls
            playsInline
            preload="metadata"
            aria-label="视频预览"
            className="h-auto w-auto min-w-64 max-w-[min(80vw,960px)] max-h-[calc(100dvh-var(--titlebar-height)-9rem)] rounded-md bg-black"
            onError={() => setError('视频无法播放，文件可能损坏或编码不受支持。')}
          />
        ) : preview.kind === 'audio' && preview.source ? (
          <audio
            src={preview.source}
            controls
            preload="metadata"
            aria-label="音频预览"
            className="my-4 w-full"
            onError={() => setError('音频无法播放，文件可能损坏或编码不受支持。')}
          />
        ) : (
          <ScrollArea viewportClassName="max-h-[65dvh] rounded-md border bg-muted/25 p-4">
            <pre className="font-mono text-xs leading-6 whitespace-pre-wrap wrap-anywhere">
              {preview.text}
            </pre>
          </ScrollArea>
        )}
      </DialogContent>
    </WorkspaceDialog>
  )
}
