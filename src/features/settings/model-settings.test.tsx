import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useConversationStore } from '@/features/conversation/store'
import { ModelSettings } from './model-settings'

const first = { provider: 'first', id: 'shared', name: 'Alpha' }
const second = { provider: 'second', id: 'shared', name: 'Alpha' }
const third = { provider: 'first', id: 'other', name: 'Gamma' }

beforeEach(() => {
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({
    status: 'ready',
    model: first,
    models: [first, second, third],
    changeModel: vi.fn().mockResolvedValue(undefined),
  })
})

test('provider groups start collapsed, expand independently, and switch the exact provider/model', async () => {
  const user = userEvent.setup()
  render(<ModelSettings />)
  expect(screen.getByText('Alpha · first')).toBeVisible()
  const firstTrigger = screen.getByRole('button', { name: 'first' })
  const secondTrigger = screen.getByRole('button', { name: 'second' })
  expect(firstTrigger).toHaveAttribute('aria-expanded', 'false')
  expect(secondTrigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()

  await user.click(firstTrigger)
  expect(within(screen.getByRole('group', { name: 'first' })).getAllByRole('radio')).toHaveLength(2)
  expect(screen.getByRole('radio', { name: 'Alpha · first' })).toBeChecked()
  await user.click(secondTrigger)
  expect(firstTrigger).toHaveAttribute('aria-expanded', 'true')
  await user.click(screen.getByRole('radio', { name: 'Alpha · second' }))
  expect(useConversationStore.getState().changeModel).toHaveBeenCalledExactlyOnceWith(second)
  await user.click(firstTrigger)
  await waitFor(() =>
    expect(screen.queryByRole('group', { name: 'first' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('group', { name: 'second' })).toBeVisible()
})

test('groups remain browsable during a running turn while model switching is disabled', async () => {
  useConversationStore.setState({ status: 'running' })
  const user = userEvent.setup()
  render(<ModelSettings />)
  await user.click(screen.getByRole('button', { name: 'first' }))
  const model = screen.getByRole('radio', { name: 'Gamma · first' })
  expect(model).toHaveAttribute('aria-disabled', 'true')
  await user.click(model)
  expect(useConversationStore.getState().changeModel).not.toHaveBeenCalled()
})

test('empty model configuration explains the empty list', () => {
  useConversationStore.setState({ models: [], model: null, status: 'disconnected' })
  render(<ModelSettings />)
  expect(screen.getByText('暂无可用模型')).toBeVisible()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
})
