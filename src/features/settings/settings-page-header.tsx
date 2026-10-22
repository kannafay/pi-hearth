import { cn } from '@/lib/utils'

export function SettingsPageHeader({
  title,
  description,
  className,
}: {
  title: string
  description: string
  className?: string
}) {
  return (
    <div data-slot="settings-page-header" className={cn('border-b pb-7', className)}>
      <h2 className="mb-1 text-lg font-medium">{title}</h2>
      <p className="text-xs leading-4 text-muted-foreground">{description}</p>
    </div>
  )
}
