import { useRef, useState } from 'react'
import { useWorkspaceStore } from '@/app/store'
import { useDialogPresence } from '@/components/use-dialog-presence'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogBody,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ProjectInfo } from '@/lib/generated/pi'
import { FieldDescription, FieldError } from '@/components/ui/field'

export function ProjectDeleteDialog({
  project,
  onClose,
}: {
  project: ProjectInfo | null
  onClose: () => void
}) {
  const presence = useDialogPresence(project)
  const [working, setWorking] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')

  async function remove() {
    if (!project || pending.current) return
    pending.current = true
    setWorking(true)
    setError('')
    try {
      await useWorkspaceStore.getState().removeProject(project)
      onClose()
    } catch (reason) {
      setError(String(reason))
    } finally {
      pending.current = false
      setWorking(false)
    }
  }

  return (
    <Dialog
      open={Boolean(project)}
      onOpenChangeComplete={(open) => {
        presence.onOpenChangeComplete(open)
        if (!open) setError('')
      }}
      onOpenChange={(open, details) => {
        if (!open && pending.current) details.cancel()
        else if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false} size="sm">
        <DialogHeader variant="compact">
          <DialogTitle>删除项目“{presence.value?.name}”？</DialogTitle>
          <DialogDescription>项目会从工作台移除，源文件夹和本地聊天记录会保留。</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FieldDescription className="break-all">{presence.value?.path}</FieldDescription>
          <FieldError>{error}</FieldError>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={working} onClick={onClose}>
            取消
          </Button>
          <Button variant="destructive" disabled={working} onClick={() => void remove()}>
            {working ? '正在删除…' : '确认删除项目'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
