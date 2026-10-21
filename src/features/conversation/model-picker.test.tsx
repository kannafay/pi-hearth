import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { ModelPicker } from './model-picker'
import { useConversationStore } from './store'

beforeEach(() => {
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})

test('the composer model picker switches directly to a configured provider/model', async () => {
  const first = { provider: 'first', id: 'a', name: 'Alpha' }
  const second = { provider: 'second', id: 'b', name: 'Beta' }
  const changeModel = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({
    status: 'ready',
    model: first,
    models: [first, second],
    changeModel,
  })
  const user = userEvent.setup()
  render(<ModelPicker compact />)
  expect(screen.getByRole('combobox', { name: '切换模型' })).toHaveTextContent('Alpha · first')
  // jsdom has no popup geometry for a pointer release over the opening trigger.
  await user.tab()
  await user.keyboard(' ')
  await user.click(await screen.findByRole('option', { name: /Beta/ }))
  expect(changeModel).toHaveBeenCalledExactlyOnceWith(second)
})

test('the model picker supports keyboard selection and Escape without changing models', async () => {
  const first = { provider: 'first', id: 'a', name: 'Alpha' }
  const second = { provider: 'second', id: 'b', name: 'Beta' }
  const changeModel = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({
    status: 'ready',
    model: first,
    models: [first, second],
    changeModel,
  })
  const user = userEvent.setup()
  render(<ModelPicker />)
  await user.tab()
  await user.keyboard(' ')
  expect(await screen.findByRole('listbox')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '切换模型' })).toHaveFocus()
  expect(changeModel).not.toHaveBeenCalled()
  await user.keyboard(' ')
  await user.keyboard('{ArrowDown}{Enter}')
  expect(changeModel).toHaveBeenCalledExactlyOnceWith(second)
})

test('model selection remains visible while a running turn prevents a mid-request change', () => {
  useConversationStore.setState({
    status: 'running',
    model: { provider: 'p', id: 'a', name: 'Alpha' },
    models: [{ provider: 'p', id: 'a', name: 'Alpha' }],
  })
  render(<ModelPicker />)
  expect(screen.getByRole('combobox', { name: '切换模型' })).toBeDisabled()
  expect(screen.getByText(/Alpha/)).toBeVisible()
})

test('models are grouped by provider and identical model IDs select the correct provider', async () => {
  const first = { provider: 'first', id: 'shared', name: 'Alpha' }
  const second = { provider: 'second', id: 'shared', name: 'Alpha' }
  const third = { provider: 'first', id: 'other', name: 'Gamma' }
  const changeModel = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({
    status: 'ready',
    model: first,
    models: [first, second, third],
    changeModel,
  })
  const user = userEvent.setup()
  render(<ModelPicker />)
  await user.click(screen.getByRole('combobox', { name: '切换模型' }))
  const firstGroup = within(await screen.findByRole('group', { name: 'first' }))
  expect(firstGroup.getAllByRole('option')).toHaveLength(2)
  expect(firstGroup.getByRole('option', { name: 'Gamma' })).toBeVisible()
  const secondGroup = within(screen.getByRole('group', { name: 'second' }))
  await user.click(secondGroup.getByRole('option', { name: 'Alpha' }))
  expect(changeModel).toHaveBeenCalledExactlyOnceWith(second)
})
