import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { isDesktop, resetWindowSize } from '@/lib/desktop'
import { SettingsRow } from './settings-row'

export function WindowSizeSettings() {
  const desktop = isDesktop()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function reset() {
    if (!desktop || pending) return
    setPending(true)
    setError('')
    try {
      await resetWindowSize()
    } catch (reason) {
      setError(`无法重置窗口大小：${String(reason)}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsRow
      title="窗口大小"
      description={desktop ? '恢复默认窗口尺寸。' : '请在桌面应用中重置窗口大小。'}
      descriptionId="window-size-description"
      control={
        <Button
          variant="outline"
          size="sm"
          aria-label="重置窗口大小"
          aria-describedby="window-size-description"
          aria-busy={pending}
          disabled={!desktop || pending}
          onClick={() => void reset()}
        >
          {pending ? '正在重置…' : '重置窗口大小'}
        </Button>
      }
    >
      <FieldError>{error}</FieldError>
    </SettingsRow>
  )
}
