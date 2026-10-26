import { useEffect } from 'react'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import { toast } from '@/lib/toast'

export function useOperationNotifications() {
  useEffect(() => {
    const workspace = useWorkspaceStore.subscribe((state, previous) => {
      if (state.error && state.error !== previous.error) toast.error(state.error)
    })
    const conversation = useConversationStore.subscribe((state, previous) => {
      if (state.error && state.error !== previous.error) toast.error(state.error)
    })
    return () => {
      workspace()
      conversation()
    }
  }, [])
}
