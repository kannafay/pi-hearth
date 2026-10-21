import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useConversationStore } from './store'
import { ThinkingPicker } from './thinking-picker'

beforeEach(() => {
  useConversationStore.setState(useConversationStore.getInitialState(), true)
})

test('the picker shows four efforts, restores the active effort, and selects native max', async () => {
  const changeThinkingLevel = vi.fn()
  useConversationStore.setState({
    status: 'ready',
    thinkingLevel: 'medium',
    availableThinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
    changeThinkingLevel,
  })
  const user = userEvent.setup()
  render(<ThinkingPicker />)
  expect(screen.getByRole('combobox', { name: '思考强度' })).toHaveTextContent('Medium')
  await user.tab()
  await user.keyboard(' ')
  const max = await screen.findByRole('option', { name: 'Max' })
  expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
    'Low',
    'Medium',
    'High',
    'Max',
  ])
  await user.click(max)
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('max')
})

test('Max uses xhigh when available and unsupported efforts cannot be selected', async () => {
  const changeThinkingLevel = vi.fn()
  useConversationStore.setState({
    status: 'ready',
    thinkingLevel: 'high',
    availableThinkingLevels: ['off', 'high', 'xhigh'],
    changeThinkingLevel,
  })
  const user = userEvent.setup()
  render(<ThinkingPicker />)
  await user.tab()
  await user.keyboard(' ')
  expect(await screen.findByRole('option', { name: 'Low' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await user.click(screen.getByRole('option', { name: 'Max' }))
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('xhigh')
  act(() => useConversationStore.setState({ status: 'running' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: '思考强度' })).toBeDisabled())
})
