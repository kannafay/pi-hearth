import { useState } from 'react'

// Keep the current content available until Base UI finishes its closing transition.
export function useDialogPresence<T>(value: T | null) {
  const [retainedValue, setRetainedValue] = useState(value)
  if (value !== null && value !== retainedValue) setRetainedValue(value)

  return {
    value: value ?? retainedValue,
    onOpenChangeComplete(open: boolean) {
      if (!open && value === null) setRetainedValue(null)
    },
  }
}
