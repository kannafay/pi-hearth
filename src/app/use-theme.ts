import { useEffect } from 'react'
import { useWorkspaceStore } from '@/app/store'
import { setWindowTheme } from '@/lib/desktop'

export function useTheme() {
  const theme = useWorkspaceStore((state) => state.theme)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    void setWindowTheme(theme === 'system' ? null : theme).catch((reason: unknown) => {
      console.warn('Unable to update the native window theme:', reason)
    })
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}
