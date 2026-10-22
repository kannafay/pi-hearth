import { FileText, ImageIcon, Music2, Play, X } from 'lucide-react'
import { cn } from 'cn'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import type { Attachment } from '@/lib/generated/pi'

export function AttachmentList({
  files,
  onRemove,
  className,
}: {
  files: Attachment[]
  onRemove?: (id: string) => void
  className?: string
}) {
  const showPreview = useWorkspaceStore((state) => state.setAttachmentPreview)
  if (!files.length) return null
  return (
    <div className={cn('flex max-w-full flex-wrap gap-2', className)} aria-label="附件列表">
      {files.map((file) => {
        const media = ['image', 'video', 'audio'].includes(file.kind)
        const label = file.kind === 'image' ? '图片' : file.kind === 'video' ? '视频' : '音频'
        return (
          <div key={file.id} className="relative min-w-0 max-w-full">
            <button
              type="button"
              aria-label={media ? `查看${label}` : `查看 ${file.name}`}
              onClick={() => showPreview(file)}
              className={`relative flex overflow-hidden rounded-md border bg-muted/25 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring ${
                media
                  ? `aspect-square ${onRemove ? 'w-14' : 'w-24'} max-w-full items-center justify-center`
                  : `max-w-[min(15rem,100%)] items-center gap-2 p-2 pr-9 ${onRemove ? 'h-14' : ''}`
              }`}
            >
              {media ? (
                <>
                  {file.kind === 'image' && file.preview ? (
                    <img src={file.preview} alt="图片附件" className="size-full object-cover" />
                  ) : file.kind === 'video' ? (
                    <Play className="size-5 fill-current text-muted-foreground" />
                  ) : file.kind === 'audio' ? (
                    <Music2 className="size-5 text-muted-foreground" />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground" />
                  )}
                </>
              ) : (
                <>
                  <FileText className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs">{file.name}</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {file.size === 0
                        ? '0 B'
                        : file.size < 1024 * 1024
                          ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                          : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
                    </span>
                  </span>
                </>
              )}
            </button>
            {onRemove && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`移除 ${file.name}`}
                className="absolute top-1 right-1 z-10 size-4 rounded-sm border-0 bg-background/90 bg-clip-border text-muted-foreground backdrop-blur-md hover:bg-background/90 hover:text-destructive focus-visible:bg-background/90 focus-visible:text-destructive dark:hover:bg-background/90 dark:focus-visible:bg-background/90"
                onClick={() => onRemove(file.id)}
              >
                <X className="size-2.5" />
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
