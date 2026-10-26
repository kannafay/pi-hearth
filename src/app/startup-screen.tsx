import { Button } from '@/components/ui/button'

export function StartupScreen({
  error,
  loading = false,
  onRetry,
}: {
  error?: string | null
  loading?: boolean
  onRetry?: () => void
}) {
  return (
    <div className="workspace-shell startup-screen">
      <div className="startup-center">
        <img src="/pi.svg" alt="Pi Hearth" className="startup-logo" width={64} height={64} />
        {error ? (
          <div className="startup-feedback">
            <p role="alert">{error}</p>
            <Button variant="outline" disabled={loading} onClick={onRetry}>
              重试
            </Button>
          </div>
        ) : (
          <div role="status" aria-label="正在打开工作台" className="startup-progress">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  )
}
