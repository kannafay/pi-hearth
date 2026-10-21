import { FileDiff, Files, X } from 'lucide-react'
import { useWorkspaceStore } from '@/app/store'
import { IconButton } from '@/components/icon-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/scroll-area'

export function Inspector() {
  const setInspectorOpen = useWorkspaceStore((state) => state.setInspectorOpen)

  return (
    <aside aria-label="项目查看面板" className="flex h-full min-h-0 flex-col bg-card">
      <Tabs defaultValue="changes" className="h-full gap-0">
        <div className="flex h-13 shrink-0 items-center justify-between border-b px-3">
          <TabsList variant="line" aria-label="项目查看">
            <TabsTrigger value="changes">变更</TabsTrigger>
            <TabsTrigger value="files">文件</TabsTrigger>
          </TabsList>
          <IconButton label="关闭查看面板" onClick={() => setInspectorOpen(false)}>
            <X />
          </IconButton>
        </div>
        <TabsContent value="changes" className="min-h-0">
          <ScrollArea className="h-full" viewportClassName="h-full p-6">
            <FileDiff aria-hidden="true" className="mb-4 size-7 text-muted-foreground" />
            <p className="font-medium">项目变更</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Git 差异查看尚未接入。</p>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="files" className="min-h-0">
          <ScrollArea className="h-full" viewportClassName="h-full p-6">
            <Files aria-hidden="true" className="mb-4 size-7 text-muted-foreground" />
            <p className="font-medium">项目文件</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              文件树与只读预览尚未接入。
            </p>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
