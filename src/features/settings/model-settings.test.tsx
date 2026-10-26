import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useConversationStore } from '@/features/conversation/store'
import { useWorkspaceStore } from '@/app/store'
import { updateAppSettings } from '@/lib/app-settings'
import type { AppSettings } from '@/lib/generated/pi'
import { ModelSettings } from './model-settings'
import { ModelPicker } from '@/features/conversation/model-picker'
import { loadModelCatalog } from '@/lib/resources'

vi.mock('@/lib/app-settings', () => ({ loadAppSettings: vi.fn(), updateAppSettings: vi.fn() }))
vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))
vi.mock('@/lib/resources', () => ({ loadModelCatalog: vi.fn() }))

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

test('settings use friendly provider names even for defaults saved before names were supported', async () => {
  useConversationStore.setState({
    models: [
      { ...first, providerName: '火山 Agent Plan' },
      { ...third, providerName: '火山 Agent Plan' },
    ],
  })
  const user = userEvent.setup()
  render(<ModelSettings />)
  expect(screen.getByText('Alpha · 火山 Agent Plan')).toBeVisible()
  expect(screen.queryByText('Alpha · first')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '火山 Agent Plan' }))
  expect(screen.getByRole('radio', { name: 'Alpha · 火山 Agent Plan' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: 'Gamma · 火山 Agent Plan' }))
  await waitFor(() => expect(useWorkspaceStore.getState().defaultModel?.id).toBe(third.id))
  expect(useWorkspaceStore.getState().defaultModel?.provider).toBe('first')
  expect(useConversationStore.getState().model).toEqual(third)
})

test('refresh reads new models without changing saved defaults or the active conversation', async () => {
  vi.mocked(loadModelCatalog).mockResolvedValueOnce([
    { provider: 'new', id: 'latest', name: 'Latest' },
  ])
  const user = userEvent.setup()
  render(<ModelSettings />)
  await user.click(screen.getByRole('button', { name: '刷新模型列表' }))
  await user.click(await screen.findByRole('button', { name: 'new' }))
  expect(screen.getByRole('radio', { name: 'Latest · new' })).toBeVisible()
  expect(useWorkspaceStore.getState().defaultModel).toEqual(first)
  expect(useConversationStore.getState().model).toEqual(third)
  expect(useConversationStore.getState().models).toEqual([first, second, third])
  expect(useConversationStore.getState().modelCatalog).toEqual([
    { provider: 'new', id: 'latest', name: 'Latest' },
  ])
  expect(updateAppSettings).not.toHaveBeenCalled()
})

test.each(['ready', 'running', 'connecting'] as const)(
  'refresh updates the composer and saved-default labels while the conversation is %s',
  async (status) => {
    useConversationStore.setState({ status, thinkingLevel: 'high' })
    const before = useConversationStore.getState()
    const renamedDefault = { ...first, name: 'Renamed Alpha', providerName: 'New Provider' }
    const renamedCurrent = { ...third, name: 'Renamed Gamma', providerName: 'New Provider' }
    const catalog = [renamedDefault, second, renamedCurrent]
    vi.mocked(loadModelCatalog).mockResolvedValueOnce(catalog)
    const user = userEvent.setup()
    render(
      <>
        <ModelSettings />
        <ModelPicker compact />
      </>,
    )
    const picker = screen.getByRole('combobox', { name: '切换模型' })
    expect(picker).toHaveTextContent('Gamma')
    await user.click(screen.getByRole('button', { name: '刷新模型列表' }))
    await waitFor(() => expect(picker).toHaveTextContent('Renamed Gamma'))
    expect(screen.getByText('Renamed Alpha · New Provider')).toBeVisible()
    const after = useConversationStore.getState()
    expect(after.model).toBe(before.model)
    expect(after.models).toBe(before.models)
    expect(after.messages).toBe(before.messages)
    expect(after.pendingSettings).toBe(before.pendingSettings)
    expect(after.status).toBe(status)
    expect(after.thinkingLevel).toBe('high')
    expect(after.changeModel).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().defaultModel).toEqual(first)
    expect(updateAppSettings).not.toHaveBeenCalled()
  },
)

test('a failed refresh keeps the last successful names available in both pickers', async () => {
  const catalog = [{ ...third, name: 'Renamed Gamma' }]
  useConversationStore.setState({ modelCatalog: catalog })
  vi.mocked(loadModelCatalog).mockRejectedValueOnce(new Error('catalog unavailable'))
  const user = userEvent.setup()
  render(
    <>
      <ModelSettings />
      <ModelPicker compact />
    </>,
  )
  await user.click(screen.getByRole('button', { name: '刷新模型列表' }))
  expect(await screen.findByText('Error: catalog unavailable')).toBeVisible()
  expect(screen.getByRole('combobox', { name: '切换模型' })).toHaveTextContent('Renamed Gamma')
  expect(useConversationStore.getState().modelCatalog).toBe(catalog)
  expect(useConversationStore.getState().changeModel).not.toHaveBeenCalled()
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

test('saving a default keeps the list enabled while preventing duplicate writes', async () => {
  let finish!: (value: AppSettings) => void
  vi.mocked(updateAppSettings).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const user = userEvent.setup()
  render(<ModelSettings />)
  await user.click(screen.getByRole('button', { name: 'first' }))
  await user.click(screen.getByRole('button', { name: 'second' }))
  const radio = screen.getByRole('radio', { name: 'Alpha · second' })
  const group = screen.getByRole('radiogroup', { name: '新对话默认模型' })
  await user.click(radio)
  expect(group).toHaveAttribute('aria-readonly', 'true')
  expect(group).toHaveAttribute('aria-busy', 'true')
  for (const item of screen.getAllByRole('radio')) {
    expect(item).not.toHaveAttribute('aria-disabled', 'true')
    expect(item.closest('label')).not.toHaveAttribute('data-disabled')
  }
  await user.click(screen.getByRole('radio', { name: 'Gamma · first' }))
  expect(updateAppSettings).toHaveBeenCalledOnce()
  expect(useConversationStore.getState().model).toEqual(third)
  finish({ defaultModel: second } as AppSettings)
  await waitFor(() => expect(radio).toBeChecked())
  expect(group).not.toHaveAttribute('aria-readonly')
  expect(group).toHaveAttribute('aria-busy', 'false')
  expect(updateAppSettings).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('radio', { name: 'Gamma · first' }))
  await waitFor(() => expect(useWorkspaceStore.getState().defaultModel).toEqual(third))
  expect(updateAppSettings).toHaveBeenCalledTimes(2)
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
