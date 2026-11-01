import { act, render, screen, within } from '@testing-library/react'
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

test('provider groups display configured names while selections keep the original IDs', async () => {
  const first = {
    provider: 'custom-first',
    providerName: '火山 Agent Plan',
    id: 'a',
    name: 'Alpha',
  }
  const second = { provider: 'custom-second', providerName: 'DeepSeek', id: 'b', name: 'Beta' }
  const changeModel = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({
    status: 'ready',
    model: first,
    models: [first, second],
    changeModel,
  })
  const user = userEvent.setup()
  render(<ModelPicker compact />)
  await user.tab()
  await user.keyboard(' ')
  expect(await screen.findByRole('group', { name: '火山 Agent Plan' })).toBeVisible()
  expect(screen.getByRole('group', { name: 'DeepSeek' })).toBeVisible()
  expect(screen.queryByText('custom-first')).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: 'Beta' }))
  expect(changeModel).toHaveBeenCalledExactlyOnceWith(second)
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
  const picker = screen.getByRole('combobox', { name: '切换模型' })
  expect(within(picker).getByText('Alpha', { exact: true })).toBeVisible()
  expect(picker).not.toHaveTextContent('first')
  // jsdom has no popup geometry for a pointer release over the opening trigger.
  await user.tab()
  await user.keyboard(' ')
  await user.click(await screen.findByRole('option', { name: /Beta/ }))
  expect(changeModel).toHaveBeenCalledExactlyOnceWith(second)
})

test('refreshed names survive stale runtime metadata and match both provider and model ID', async () => {
  const first = { provider: 'first', id: 'shared', name: 'Alpha' }
  const second = { provider: 'second', id: 'shared', name: 'Beta' }
  const renamed = { ...first, name: 'Renamed Alpha', providerName: 'Renamed Provider' }
  const changeModel = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({
    status: 'ready',
    model: first,
    models: [first, second],
    changeModel,
  })
  const user = userEvent.setup()
  render(<ModelPicker compact />)
  const picker = screen.getByRole('combobox', { name: '切换模型' })
  act(() => useConversationStore.setState({ modelCatalog: [renamed] }))
  expect(picker).toHaveTextContent('Renamed Alpha')
  act(() => useConversationStore.setState({ model: { ...first }, models: [{ ...first }, second] }))
  expect(picker).toHaveTextContent('Renamed Alpha')
  await user.tab()
  await user.keyboard(' ')
  expect(screen.getByRole('group', { name: 'Renamed Provider' })).toBeVisible()
  expect(screen.getByRole('group', { name: 'second' })).toBeVisible()
  await user.click(screen.getByRole('option', { name: 'Beta' }))
  expect(changeModel).toHaveBeenCalledExactlyOnceWith(second)
  act(() =>
    useConversationStore.setState({
      pendingSettings: { model: second, thinkingLevel: 'high' },
      settingsPending: 'model',
    }),
  )
  expect(picker).toHaveTextContent('Beta')
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

test('model selection remains usable while the current reply is running', async () => {
  const model = { provider: 'p', id: 'a', name: 'Alpha' }
  const next = { provider: 'p', id: 'b', name: 'Beta' }
  const changeModel = vi.fn()
  useConversationStore.setState({
    status: 'running',
    model,
    models: [model, next],
    changeModel,
  })
  const user = userEvent.setup()
  render(<ModelPicker />)
  expect(screen.getByRole('combobox', { name: '切换模型' })).toBeEnabled()
  expect(screen.getByText(/Alpha/)).toBeVisible()
  await user.tab()
  await user.keyboard(' ')
  await user.click(screen.getByRole('option', { name: 'Beta' }))
  expect(changeModel).toHaveBeenCalledExactlyOnceWith(next)
})

test('models remain selectable through connection and settings acknowledgements show the latest choice', async () => {
  const first = { provider: 'first', id: 'a', name: 'Alpha' }
  const second = { provider: 'second', id: 'b', name: 'Beta' }
  const changeModel = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({
    status: 'connecting',
    model: null,
    models: [first, second],
    changeModel,
  })
  const user = userEvent.setup()
  render(<ModelPicker compact />)
  const picker = screen.getByRole('combobox', { name: '切换模型' })
  expect(picker).toBeEnabled()
  await user.tab()
  await user.keyboard(' ')
  await user.click(screen.getByRole('option', { name: 'Beta' }))
  expect(changeModel).toHaveBeenCalledExactlyOnceWith(second)
  act(() =>
    useConversationStore.setState({
      status: 'ready',
      model: first,
      settingsPending: 'model',
      pendingSettings: { model: second, thinkingLevel: 'high' },
    }),
  )
  expect(picker).toBeEnabled()
  expect(picker).toHaveTextContent('Beta')
  await user.keyboard(' ')
  await user.click(screen.getByRole('option', { name: 'Alpha' }))
  expect(changeModel).toHaveBeenLastCalledWith(first)
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
