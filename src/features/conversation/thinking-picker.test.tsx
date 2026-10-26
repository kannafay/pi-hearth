import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useConversationStore } from './store'
import { ThinkingPicker } from './thinking-picker'
import { loadThinkingPreference, saveThinkingPreference } from './thinking-preference'

beforeEach(() => {
  localStorage.clear()
  useConversationStore.setState(useConversationStore.getInitialState(), true)
})

test('Default is initially selected and six explicit efforts include Off, XHigh and Max', async () => {
  const changeThinkingLevel = vi.fn()
  useConversationStore.setState({
    status: 'ready',
    thinkingLevel: 'medium',
    availableThinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
    changeThinkingLevel,
  })
  const user = userEvent.setup()
  render(<ThinkingPicker />)
  expect(screen.getByRole('combobox', { name: '思考强度' })).toHaveTextContent('Default')
  await user.tab()
  await user.keyboard(' ')
  expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
    'Default',
    'Off',
    'Low',
    'Medium',
    'High',
    'XHigh',
    'Max',
  ])
  await user.click(screen.getByRole('option', { name: 'XHigh' }))
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('xhigh')
})

test('Off can be explicitly selected instead of Default', async () => {
  const changeThinkingLevel = vi.fn()
  useConversationStore.setState({
    status: 'ready',
    thinkingLevel: 'medium',
    availableThinkingLevels: ['off', 'medium'],
    changeThinkingLevel,
  })
  const user = userEvent.setup()
  render(<ThinkingPicker />)
  const picker = screen.getByRole('combobox', { name: '思考强度' })
  await user.click(picker)
  await user.click(screen.getByRole('option', { name: 'Off' }))
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('off')
  act(() => useConversationStore.setState({ thinkingLevel: 'off', requestedThinkingLevel: 'off' }))
  expect(picker).toHaveTextContent('Off')
})

test('a model with two native levels enables only its supported effort and Default', async () => {
  const changeThinkingLevel = vi.fn()
  useConversationStore.setState({
    status: 'ready',
    thinkingLevel: 'high',
    availableThinkingLevels: ['off', 'high'],
    changeThinkingLevel,
  })
  const user = userEvent.setup()
  render(<ThinkingPicker />)
  await user.tab()
  await user.keyboard(' ')
  for (const label of ['Low', 'Medium', 'XHigh', 'Max']) {
    expect(screen.getByRole('option', { name: label })).toHaveAttribute('aria-disabled', 'true')
  }
  expect(screen.getByRole('option', { name: 'Default' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await user.click(screen.getByRole('option', { name: 'High' }))
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('high')
})

test('non-reasoning models offer Default and Off while reasoning efforts are disabled', async () => {
  useConversationStore.setState({
    status: 'ready',
    thinkingLevel: 'off',
    availableThinkingLevels: ['off'],
  })
  const user = userEvent.setup()
  render(<ThinkingPicker />)
  await user.tab()
  await user.keyboard(' ')
  expect(
    screen.getAllByRole('option').filter((item) => item.getAttribute('aria-disabled') === 'true'),
  ).toHaveLength(5)
  expect(screen.getByRole('option', { name: 'Off' })).not.toHaveAttribute('aria-disabled', 'true')
})

test('a manual XHigh selection remains distinct from Max and can be reset to Default', async () => {
  const changeThinkingLevel = vi.fn()
  useConversationStore.setState({
    status: 'ready',
    thinkingLevel: 'xhigh',
    requestedThinkingLevel: 'xhigh',
    availableThinkingLevels: ['high', 'xhigh'],
    changeThinkingLevel,
  })
  const user = userEvent.setup()
  render(<ThinkingPicker />)
  const picker = screen.getByRole('combobox', { name: '思考强度' })
  expect(picker).toHaveTextContent('XHigh')
  await user.tab()
  await user.keyboard(' ')
  expect(screen.getByRole('option', { name: 'Off' })).toHaveAttribute('aria-disabled', 'true')
  await user.click(screen.getByRole('option', { name: 'Default' }))
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('default')
  act(() => useConversationStore.setState({ settingsPending: 'model' }))
  expect(picker).toBeEnabled()
})

test('effort choices stay available while connecting and display the queued choice immediately', async () => {
  const changeThinkingLevel = vi.fn()
  useConversationStore.setState({
    status: 'connecting',
    availableThinkingLevels: [],
    changeThinkingLevel,
  })
  const user = userEvent.setup()
  render(<ThinkingPicker />)
  const picker = screen.getByRole('combobox', { name: '思考强度' })
  expect(picker).toBeEnabled()
  await user.tab()
  await user.keyboard(' ')
  expect(
    screen.getAllByRole('option').every((item) => item.getAttribute('aria-disabled') !== 'true'),
  ).toBe(true)
  await user.click(screen.getByRole('option', { name: 'Max' }))
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('max')
  act(() =>
    useConversationStore.setState({
      status: 'ready',
      settingsPending: 'thinking',
      pendingSettings: { model: null, thinkingLevel: 'max' },
    }),
  )
  expect(picker).toBeEnabled()
  expect(picker).toHaveTextContent('Max')
})

test('a pending model does not constrain efforts using the previous model capabilities', async () => {
  const changeThinkingLevel = vi.fn()
  useConversationStore.setState({
    status: 'ready',
    model: { provider: 'p', id: 'old', name: 'Old' },
    availableThinkingLevels: ['off'],
    settingsPending: 'model',
    pendingSettings: {
      model: { provider: 'p', id: 'new', name: 'New' },
      thinkingLevel: 'default',
    },
    changeThinkingLevel,
  })
  const user = userEvent.setup()
  render(<ThinkingPicker />)
  await user.tab()
  await user.keyboard(' ')
  await user.click(screen.getByRole('option', { name: 'High' }))
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('high')
})

test('the old fixed effort is replaced by Default and explicit choices including Off are remembered', async () => {
  localStorage.setItem('pi-hearth.thinking-level', 'high')
  expect(loadThinkingPreference()).toBe('default')
  await saveThinkingPreference('xhigh')
  expect(loadThinkingPreference()).toBe('xhigh')
  await saveThinkingPreference('off')
  expect(loadThinkingPreference()).toBe('off')
  await saveThinkingPreference('default')
  expect(loadThinkingPreference()).toBe('default')
})
