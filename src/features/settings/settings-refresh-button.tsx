import { LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SettingsRefreshButton({
  label,
  loading,
  disabled,
  onClick,
}: {
  label: string
  loading: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || loading}
      aria-label={label}
      onClick={onClick}
    >
      {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
      刷新
    </Button>
  )
}
