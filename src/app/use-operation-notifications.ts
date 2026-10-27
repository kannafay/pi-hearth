import { useEffect } from 'react'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import { toast } from '@/lib/toast'
import { describeResponseError } from '@/features/conversation/response-error-message'

export function useOperationNotifications() {
  useEffect(() => {
    const workspace = useWorkspaceStore.subscribe((state, previous) => {
      if (state.error && state.error !== previous.error) toast.error(state.error)
    })
    const conversation = useConversationStore.subscribe((state, previous) => {
      if (state.error && state.error !== previous.error)
        toast.error(describeResponseError(state.error)?.message ?? state.error)
    })
    return () => {
      workspace()
      conversation()
    }
  }, [])
}
