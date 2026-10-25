import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useConversationStore } from '@/features/conversation/store'
import { useWorkspaceStore } from '@/app/store'
import { updateAppSettings } from '@/lib/app-settings'
import type { AppSettings } from '@/lib/generated/pi'
import { ModelSettings } from './model-settings'

vi.mock('@/lib/app-settings', () => ({ loadAppSettings: vi.fn(), updateAppSettings: vi.fn() }))
vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))

const first = { provider: 'first', id: 'shared', name: 'Alpha' }
const second = { provider: 'second', id: 'shared', name: 'Alpha' }
const third = { provider: 'first', id: 'other', name: 'Gamma' }

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.setState({ settingsReady: true, defaultModel: first })
  vi.mocked(updateAppSettings).mockImplementation(
    async (patch) => ({ defaultModel: patch.defaultModel }) as AppSettings,
  )
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({
    status: 'ready',
    model: third,
    models: [first, second, third],
    changeModel: vi.fn().mockResolvedValue(undefined),
  })
})

test('provider groups save the exact default provider/model without changing the current conversation', async () => {
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
  await waitFor(() => expect(useWorkspaceStore.getState().defaultModel).toEqual(second))
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({ defaultModel: second })
  expect(useConversationStore.getState().model).toEqual(third)
  expect(useConversationStore.getState().changeModel).not.toHaveBeenCalled()
  await user.click(firstTrigger)
  await waitFor(() =>
    expect(screen.queryByRole('group', { name: 'first' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('group', { name: 'second' })).toBeVisible()
})

test.each(['running', 'connecting', 'ready'] as const)(
  'defaults remain configurable while the current conversation is %s',
  async (status) => {
    useConversationStore.setState({
      status,
      readOnly: status === 'ready' ? 'missing directory' : null,
    })
    const user = userEvent.setup()
    render(<ModelSettings />)
    await user.click(screen.getByRole('button', { name: 'first' }))
    const model = screen.getByRole('radio', { name: 'Gamma · first' })
    expect(model).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(model)
    await waitFor(() => expect(useWorkspaceStore.getState().defaultModel).toEqual(third))
    expect(useConversationStore.getState().changeModel).not.toHaveBeenCalled()
  },
)

test('saving a default disables duplicate writes and leaves the current model unchanged', async () => {
  let finish!: (value: AppSettings) => void
  vi.mocked(updateAppSettings).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const user = userEvent.setup()
  render(<ModelSettings />)
  await user.click(screen.getByRole('button', { name: 'second' }))
  const radio = screen.getByRole('radio', { name: 'Alpha · second' })
  await user.click(radio)
  expect(radio).toHaveAttribute('aria-disabled', 'true')
  expect(useConversationStore.getState().model).toEqual(third)
  finish({ defaultModel: second } as AppSettings)
  await waitFor(() => expect(radio).toBeChecked())
  expect(updateAppSettings).toHaveBeenCalledOnce()
})

test('an unavailable saved default remains remembered and explains the fallback', () => {
  useWorkspaceStore.setState({ defaultModel: { provider: 'missing', id: 'gone', name: 'Gone' } })
  render(<ModelSettings />)
  expect(screen.getByText('Gone · missing')).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('默认模型当前不可用')
  expect(updateAppSettings).not.toHaveBeenCalled()
})

test('empty model configuration explains the empty list', () => {
  useConversationStore.setState({ models: [], model: null, status: 'disconnected' })
  render(<ModelSettings />)
  expect(screen.getByText('暂无可用模型')).toBeVisible()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
})
