import { act, renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { useDialogPresence } from './use-dialog-presence'

test('closing retains the payload until the dialog transition finishes', () => {
  const attachment = { id: 'image', name: 'image.png' }
  const { result, rerender } = renderHook(({ value }) => useDialogPresence(value), {
    initialProps: { value: attachment as typeof attachment | null },
  })

  rerender({ value: null })
  expect(result.current.value).toBe(attachment)
  act(() => result.current.onOpenChangeComplete(false))
  expect(result.current.value).toBeNull()
})

test('reopening during an exit preserves the latest payload', () => {
  const { result, rerender } = renderHook(({ value }) => useDialogPresence(value), {
    initialProps: { value: 'first' as string | null },
  })

  rerender({ value: null })
  rerender({ value: 'second' })
  act(() => result.current.onOpenChangeComplete(false))
  expect(result.current.value).toBe('second')
  rerender({ value: null })
  expect(result.current.value).toBe('second')
  act(() => result.current.onOpenChangeComplete(false))
  expect(result.current.value).toBeNull()
})
