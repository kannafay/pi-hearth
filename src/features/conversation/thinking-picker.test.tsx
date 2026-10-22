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

test('Default is initially selected and five explicit efforts include distinct XHigh and Max', async () => {
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
    'Low',
    'Medium',
    'High',
    'XHigh',
    'Max',
  ])
  await user.click(screen.getByRole('option', { name: 'XHigh' }))
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('xhigh')
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

test('non-reasoning models retain Default while every explicit effort is disabled', async () => {
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
  await user.click(screen.getByRole('option', { name: 'Default' }))
  expect(changeThinkingLevel).toHaveBeenCalledExactlyOnceWith('default')
  act(() => useConversationStore.setState({ settingsPending: 'model' }))
  expect(picker).toBeDisabled()
})

test('the old fixed effort is replaced by Default and new choices can still be remembered', () => {
  localStorage.setItem('pi-hearth.thinking-level', 'high')
  expect(loadThinkingPreference()).toBe('default')
  saveThinkingPreference('xhigh')
  expect(loadThinkingPreference()).toBe('xhigh')
  saveThinkingPreference('default')
  expect(loadThinkingPreference()).toBe('default')
})
