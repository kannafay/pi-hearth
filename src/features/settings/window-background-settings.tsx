import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore } from '@/app/store'
import { FieldError } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isDesktop } from '@/lib/desktop'
import { usesNativeSystemTheme } from '@/lib/system-theme'
import { SettingsRow } from './settings-row'

const options = [
  { value: 'mica', label: '云母', description: '融合桌面壁纸颜色，切换后立即生效。' },
  { value: 'acrylic', label: '毛玻璃', description: '模糊透出窗口下方的内容，切换后立即生效。' },
  { value: 'solid', label: '纯色', description: '使用纯色背景，关闭材质效果。' },
] as const

export function WindowBackgroundSettings() {
  const { background, pending, setBackground } = useWorkspaceStore(
    useShallow((state) => ({
      background: state.windowBackground,
      pending: state.windowBackgroundPending,
      setBackground: state.setWindowBackground,
    })),
  )
  const [error, setError] = useState('')
  const supported = isDesktop() && usesNativeSystemTheme()
  const selected = options.find((item) => item.value === background) ?? options[0]

  async function change(value: unknown) {
    const option = options.find((item) => item.value === value)
    if (!supported || pending || !option) return
    setError('')
    try {
      await setBackground(option.value)
    } catch (reason) {
      setError(`无法保存窗口背景：${String(reason)}`)
    }
  }

  return (
    <SettingsRow
      title="窗口背景"
      htmlFor="window-background"
      descriptionId="window-background-description"
      description={supported ? selected.description : '窗口背景材质仅在 Windows 桌面应用中可用。'}
      control={
        <Select items={options} value={background} onValueChange={(value) => void change(value)}>
          <SelectTrigger
            id="window-background"
            aria-label="窗口背景"
            aria-describedby="window-background-description"
            aria-busy={pending}
            disabled={!supported || pending}
            className="w-32"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      }
    >
      <FieldError>{error}</FieldError>
    </SettingsRow>
  )
}
