import { useEffect, useState, type ReactNode } from 'react'
import { Activity, Archive, HardDrive, Info, Palette, SlidersHorizontal } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { themeOptions } from '@/app/theme-options'
import { useMediaQuery } from '@/app/use-media-query'
import { useConversationStore } from '@/features/conversation/store'
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { WorkspaceDialog } from '@/components/workspace-dialog'
import { ScrollArea } from '@/components/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getAppVersion, isDesktop } from '@/lib/desktop'
import { ModelSettings } from './model-settings'
import { SettingsPageHeader } from './settings-page-header'
import { ArchivedSessions } from './archived-sessions'
import { ProjectLocationSettings } from './project-location-settings'
import { StorageLocationSettings } from './storage-location-settings'
import { DeveloperModeSettings } from './developer-mode-settings'
import { SettingsRow } from './settings-row'
import { FieldError } from '@/components/ui/field'

const sections = [
  { value: 'appearance', label: '外观', icon: Palette },
  { value: 'models', label: '模型与凭证', icon: SlidersHorizontal },
  { value: 'storage', label: '存储', icon: HardDrive },
  { value: 'archived', label: '归档', icon: Archive },
  { value: 'diagnostics', label: '运行诊断', icon: Activity },
  { value: 'about', label: '关于', icon: Info },
] as const

type SettingsSection = (typeof sections)[number]['value']

function SettingsPanel({
  value,
  title,
  description,
  children,
}: {
  value: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <TabsContent
      value={value}
      aria-label={title}
      className="settings-panel m-0 flex min-h-0 flex-col"
    >
      <div className="shrink-0 px-(--settings-page-inset) pt-5 max-sm:pt-4">
        <SettingsPageHeader title={title} description={description} />
      </div>
      <ScrollArea
        className="flex-1"
        viewportClassName="h-full overflow-x-hidden overflow-y-auto px-(--settings-page-inset) pb-(--settings-page-inset)"
      >
        {children}
      </ScrollArea>
    </TabsContent>
  )
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { theme, setTheme } = useWorkspaceStore()
  const { label: themeLabel, icon: ThemeIcon } =
    themeOptions.find((item) => item.value === theme) ?? themeOptions[0]
  const status = useConversationStore((state) => state.status)
  const compact = useMediaQuery('(width < 640px)')
  const [section, setSection] = useState<SettingsSection>('appearance')
  const currentSection = sections.find((item) => item.value === section) ?? sections[0]
  const SectionIcon = currentSection.icon
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function selectSection(value: unknown) {
    const next = sections.find((item) => item.value === value)
    if (next) setSection(next.value)
  }
  useEffect(() => {
    if (!open || !isDesktop()) return
    let disposed = false
    getAppVersion().then(
      (value) => {
        if (!disposed) {
          setVersion(value)
          setError(null)
        }
      },
      (reason: unknown) => {
        if (!disposed) setError(String(reason))
      },
    )
    return () => {
      disposed = true
    }
  }, [open])

  return (
    <WorkspaceDialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setSection('appearance')
      }}
    >
      <DialogContent layout="panel" size="xl" className="settings-dialog">
        <DialogTitle className="sr-only">设置</DialogTitle>
        <DialogDescription className="sr-only">
          Pi Hearth 的外观、模型、归档与运行信息。
        </DialogDescription>
        <Tabs
          value={section}
          onValueChange={selectSection}
          orientation="vertical"
          className={`h-[min(520px,85dvh)] gap-0 ${compact ? 'flex-col' : 'flex-row'}`}
        >
          <div
            className={
              compact
                ? 'flex h-13 shrink-0 items-center gap-3 px-4 pr-12'
                : 'w-44 shrink-0 border-r bg-background p-4'
            }
          >
            <p className={`text-sm font-medium ${compact ? 'shrink-0' : 'mb-6 px-2 pt-1'}`}>设置</p>
            {compact ? (
              <Select items={sections} value={section} onValueChange={selectSection}>
                <SelectTrigger aria-label="设置分类" className="min-w-0 flex-1">
                  <SelectValue>
                    <SectionIcon aria-hidden className="size-4 stroke-[1.6]" />
                    <span>{currentSection.label}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {sections.map(({ value, label, icon: Icon }) => (
                      <SelectItem key={value} value={value}>
                        <Icon aria-hidden className="size-4 stroke-[1.6]" />
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <TabsList className="h-auto w-full items-stretch gap-1 rounded-none bg-transparent p-0 shadow-none">
                {sections.map(({ value, label, icon: Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="h-8 flex-none justify-start gap-2 rounded-md border-0 px-2 text-[13px] font-normal text-muted-foreground shadow-none data-active:bg-accent data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-none dark:data-active:bg-accent after:hidden"
                  >
                    <Icon className="size-4 stroke-[1.6]" />
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
          </div>
          <div className="settings-panels min-h-0 min-w-0 flex-1">
            <SettingsPanel value="appearance" title="外观" description="让工作台适合你的使用环境。">
              <SettingsRow
                title="界面主题"
                description="选择浅色、深色或跟随系统。"
                htmlFor="settings-theme"
                descriptionId="settings-theme-description"
                control={
                  <Select
                    items={themeOptions}
                    value={theme}
                    onValueChange={(value) => {
                      if (value === 'system' || value === 'light' || value === 'dark')
                        setTheme(value)
                    }}
                  >
                    <SelectTrigger
                      id="settings-theme"
                      aria-label="界面主题"
                      aria-describedby="settings-theme-description"
                      className="w-32"
                    >
                      <SelectValue>
                        <ThemeIcon aria-hidden className="size-3.5 stroke-[1.6]" />
                        <span>{themeLabel}</span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {themeOptions.map(({ value, label, icon: Icon }) => (
                          <SelectItem key={value} value={value}>
                            <Icon aria-hidden className="size-3.5 self-center stroke-[1.6]" />
                            {label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
              />
            </SettingsPanel>
            <SettingsPanel
              value="models"
              title="模型与凭证"
              description="使用本机 Pi 配置，兼容 CC Switch。"
            >
              <ModelSettings />
            </SettingsPanel>
            <SettingsPanel
              value="storage"
              title="存储"
              description="管理本机文件和项目的保存位置。"
            >
              <ProjectLocationSettings />
              <StorageLocationSettings kind="files" />
            </SettingsPanel>
            <SettingsPanel
              value="archived"
              title="归档"
              description="归档的项目和聊天会保留在本机，可随时恢复。"
            >
              <ArchivedSessions />
            </SettingsPanel>
            <SettingsPanel
              value="diagnostics"
              title="运行诊断"
              description="本地桌面核心与 Pi 的连接状态。"
            >
              {!isDesktop() ? (
                <p className="border-b py-5 text-sm text-muted-foreground">
                  当前为浏览器预览，本地项目和桌面能力需在桌面应用中使用。
                </p>
              ) : error ? (
                <SettingsRow title="桌面核心">
                  <FieldError>桌面核心连接失败：{error}</FieldError>
                </SettingsRow>
              ) : (
                <>
                  <SettingsRow
                    title="桌面核心"
                    description={version ? `已连接桌面核心，版本 ${version}` : '正在连接桌面核心…'}
                  />
                  <SettingsRow
                    title="Pi RPC"
                    value={
                      status === 'disconnected'
                        ? '未连接'
                        : status === 'running' || status === 'stopping'
                          ? '任务执行中'
                          : status === 'connecting'
                            ? '正在连接'
                            : '已就绪'
                    }
                  />
                </>
              )}
              <DeveloperModeSettings />
            </SettingsPanel>
            <SettingsPanel value="about" title="Pi Hearth" description="Pi Coding Agent 桌面工作台">
              <SettingsRow title="版本" value={version ?? '开发预览'} />
              <p className="mt-5 text-xs leading-6 text-muted-foreground">
                在本机管理项目、对话和工具执行，共享 Pi CLI 的会话。模型配置由 Pi 与 CC Switch
                管理。
              </p>
            </SettingsPanel>
          </div>
        </Tabs>
      </DialogContent>
    </WorkspaceDialog>
  )
}
