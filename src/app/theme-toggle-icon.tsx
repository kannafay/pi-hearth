import { themeOptions } from './theme-options'

export function ThemeToggleIcon() {
  return (
    <span aria-hidden className="theme-toggle-icon contents">
      {themeOptions.map(({ value, icon: Icon }) => (
        <Icon key={value} data-theme-icon={value} />
      ))}
    </span>
  )
}
