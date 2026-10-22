import { useEffect, useState } from 'react'
import { Activity, Archive, Info, Palette, SlidersHorizontal } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
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

const sections = [
  { value: 'appearance', label: '外观', icon: Palette },
  { value: 'models', label: '模型与凭证', icon: SlidersHorizontal },
  { value: 'archived', label: '归档', icon: Archive },
  { value: 'diagnostics', label: '运行诊断', icon: Activity },
  { value: 'about', label: '关于', icon: Info },
] as const

const themes = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { theme, setTheme } = useWorkspaceStore()
  const status = useConversationStore((state) => state.status)
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
    <WorkspaceDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-190">
        <DialogTitle className="sr-only">设置</DialogTitle>
        <DialogDescription className="sr-only">
          Pi Hearth 的外观、模型、归档与运行信息。
        </DialogDescription>
        <Tabs
          defaultValue="appearance"
          orientation="vertical"
          className="h-[min(520px,85dvh)] flex-row gap-0"
        >
          <div className="w-44 shrink-0 border-r bg-background p-4">
            <p className="mb-6 px-2 pt-1 text-sm font-medium">设置</p>
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
          </div>
          <ScrollArea
            className="min-w-0 flex-1"
            viewportClassName="h-full overflow-x-hidden overflow-y-auto px-7 py-7"
          >
            <TabsContent value="appearance" className="m-0">
              <SettingsPageHeader title="外观" description="让工作台适合你的使用环境。" />
              <div className="flex items-center justify-between gap-5 border-b py-5">
                <div>
                  <h3 className="text-sm font-normal">界面主题</h3>
                  <p className="mt-1.5 text-xs text-muted-foreground">选择浅色、深色或跟随系统。</p>
                </div>
                <Select
                  items={themes}
                  value={theme}
                  onValueChange={(value) => {
                    if (value === 'system' || value === 'light' || value === 'dark') setTheme(value)
                  }}
                >
                  <SelectTrigger aria-label="界面主题" className="w-32 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {themes.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>
            <TabsContent value="models" className="m-0">
              <ModelSettings />
            </TabsContent>
            <TabsContent value="archived" className="m-0">
              <ArchivedSessions />
            </TabsContent>
            <TabsContent value="diagnostics" className="m-0">
              <SettingsPageHeader title="运行诊断" description="本地桌面核心与 Pi 的连接状态。" />
              {!isDesktop() ? (
                <p className="border-b py-5 text-sm text-muted-foreground">
                  当前为浏览器预览，本地项目和桌面能力需在桌面应用中使用。
                </p>
              ) : error ? (
                <p role="alert" className="border-b py-5 text-sm text-destructive">
                  桌面核心连接失败：{error}
                </p>
              ) : (
                <div className="divide-y border-b">
                  <div className="py-5">
                    <h3 className="text-sm font-normal">桌面核心</h3>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {version ? `已连接桌面核心，版本 ${version}` : '正在连接桌面核心…'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-5 py-5 text-sm">
                    <h3 className="text-sm font-normal">Pi RPC</h3>
                    <span className="text-muted-foreground">
                      {status === 'disconnected'
                        ? '未连接'
                        : status === 'running' || status === 'stopping'
                          ? '任务执行中'
                          : status === 'connecting'
                            ? '正在连接'
                            : '已就绪'}
                    </span>
                  </div>
                </div>
              )}
            </TabsContent>
            <TabsContent value="about" className="m-0">
              <SettingsPageHeader title="Pi Hearth" description="Pi Coding Agent 桌面工作台" />
              <div className="flex items-center justify-between gap-5 border-b py-5 text-sm">
                <h3 className="text-sm font-normal">版本</h3>
                <span className="text-muted-foreground">{version ?? '开发预览'}</span>
              </div>
              <p className="mt-5 text-xs leading-6 text-muted-foreground">
                在本机管理项目、对话和工具执行，共享 Pi CLI 的会话。模型配置由 Pi 与 CC Switch
                管理。
              </p>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </WorkspaceDialog>
  )
}
