import { FileDiff, Files } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/scroll-area'
import { WorkspacePanelHeader } from './workspace-panel'

export type InspectorTab = 'changes' | 'files'

export function Inspector({
  tab,
  onTabChange,
}: {
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
}) {
  const setInspectorOpen = useWorkspaceStore((state) => state.setInspectorOpen)

  return (
    <aside
      aria-label="项目查看面板"
      className="flex h-full min-h-0 flex-col bg-card text-sm text-card-foreground"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === 'changes' || value === 'files') onTabChange(value)
        }}
        className="h-full gap-0"
      >
        <WorkspacePanelHeader closeLabel="关闭查看面板" onClose={() => setInspectorOpen(false)}>
          <TabsList variant="line" aria-label="项目查看">
            <TabsTrigger value="changes">变更</TabsTrigger>
            <TabsTrigger value="files">文件</TabsTrigger>
          </TabsList>
        </WorkspacePanelHeader>
        <TabsContent value="changes" className="min-h-0">
          <ScrollArea className="h-full" viewportClassName="h-full p-4">
            <FileDiff
              aria-hidden="true"
              className="mb-3 size-5 stroke-[1.5] text-muted-foreground"
            />
            <p className="text-[13px] font-medium">项目变更</p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Git 差异查看尚未接入。</p>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="files" className="min-h-0">
          <ScrollArea className="h-full" viewportClassName="h-full p-4">
            <Files aria-hidden="true" className="mb-3 size-5 stroke-[1.5] text-muted-foreground" />
            <p className="text-[13px] font-medium">项目文件</p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              文件树与只读预览尚未接入。
            </p>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
