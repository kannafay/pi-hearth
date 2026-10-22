export function SettingsPageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div data-slot="settings-page-header" className="border-b pb-7">
      <h2 className="mb-1 text-lg font-medium">{title}</h2>
      <p className="text-xs leading-4 text-muted-foreground">{description}</p>
    </div>
  )
}
