import { useId, useRef, useState } from 'react'
import { useWorkspaceStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError, FieldGroup } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogBody,
  DialogForm,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import type { SessionInfo } from '@/lib/generated/pi'

export function SessionRenameDialog({
  session,
  open,
  onClose,
  onOpenChangeComplete,
}: {
  session: SessionInfo
  open: boolean
  onClose: () => void
  onOpenChangeComplete: (open: boolean) => void
}) {
  const [title, setTitle] = useState(session.title.replace(/\s+/g, ' '))
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const focused = useRef(false)
  const id = useId()

  async function save() {
    if (pending.current || !title.trim()) return
    pending.current = true
    setWorking(true)
    setError('')
    try {
      await useWorkspaceStore.getState().renameSession(session, title)
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
      open={open}
      onOpenChangeComplete={onOpenChangeComplete}
      onOpenChange={(next, details) => {
        if (!next && pending.current) details.cancel()
        else if (!next) onClose()
      }}
    >
      <DialogContent size="sm" showCloseButton={false}>
        <DialogHeader variant="compact">
          <DialogTitle>重命名会话</DialogTitle>
          <DialogDescription className="sr-only">
            为此会话设置一个方便辨认的标题。
          </DialogDescription>
        </DialogHeader>
        <DialogForm
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <DialogBody>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={id}>会话标题</FieldLabel>
                <Input
                  id={id}
                  autoFocus
                  maxLength={160}
                  value={title}
                  disabled={working}
                  onFocus={(event) => {
                    if (!focused.current) {
                      focused.current = true
                      event.currentTarget.select()
                    }
                  }}
                  onChange={(event) => {
                    setTitle(event.target.value)
                    setError('')
                  }}
                />
              </Field>
              <FieldError>{error}</FieldError>
            </FieldGroup>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={working} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={working || !title.trim()}>
              {working ? '正在保存…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  )
}
