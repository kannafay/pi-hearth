import type { ComponentProps } from 'react'
import { Dialog } from '@/components/ui/dialog'

// WorkspaceShell makes the content inert while the window header stays usable.
export function WorkspaceDialog(props: Omit<ComponentProps<typeof Dialog>, 'modal'>) {
  return <Dialog {...props} modal={false} />
}
