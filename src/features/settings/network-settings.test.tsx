import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { emptyConversation, useConversationStore } from '@/features/conversation/store'
import { updateAppSettings } from '@/lib/app-settings'
import { isDesktop } from '@/lib/desktop'
import { defaultProxySettings, testProxyConnection } from '@/lib/network'
import { toast } from '@/lib/toast'
import type { AppSettings, ProxySettings } from '@/lib/generated/pi'
import { NetworkSettings } from './network-settings'

vi.mock('@/lib/app-settings', () => ({ loadAppSettings: vi.fn(), updateAppSettings: vi.fn() }))
vi.mock('@/lib/desktop', () => ({ isDesktop: vi.fn() }))
vi.mock('@/lib/network', async (original) => ({
  ...(await original<typeof import('@/lib/network')>()),
  testProxyConnection: vi.fn(),
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isDesktop).mockReturnValue(true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useWorkspaceStore.setState({ settingsReady: true, projectPath: 'project' })
  useConversationStore.setState({
    status: 'ready',
    instanceId: 'runtime',
    sessionId: 'current',
    sessionFile: 'history.jsonl',
    connect: vi.fn().mockResolvedValue(undefined),
  })
  vi.mocked(updateAppSettings).mockImplementation(
    async (patch) => ({ proxy: patch.proxy }) as AppSettings,
  )
  vi.mocked(testProxyConnection).mockResolvedValue({ status: 204, elapsedMs: 120 })
})

async function manual(user: ReturnType<typeof userEvent.setup>, url: string) {
  await user.tab()
  await user.keyboard(' ')
  await user.click(await screen.findByRole('option', { name: '手动代理' }))
  await user.type(screen.getByRole('textbox', { name: '代理地址' }), url)
}

test.each(['http://127.0.0.1:7890', 'socks5://127.0.0.1:1080'])(
  'saving %s persists once and reconnects the same conversation even before catalog refresh',
  async (url) => {
    const user = userEvent.setup()
    render(<NetworkSettings />)
    await manual(user, url)
    await user.click(screen.getByRole('button', { name: '保存并应用' }))
    await waitFor(() =>
      expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({
        proxy: { ...defaultProxySettings, mode: 'manual', url },
      }),
    )
    expect(useConversationStore.getState().connect).toHaveBeenCalledExactlyOnceWith(
      'project',
      'history.jsonl',
      { force: true, sessionId: 'current' },
    )
    expect(useWorkspaceStore.getState()).toMatchObject({
      proxyPending: false,
      sessionActionPending: null,
      proxy: { mode: 'manual', url },
    })
    expect(screen.getByRole('button', { name: '保存并应用' })).toBeDisabled()
  },
)

test('testing uses the unsaved configuration without changing proxy preferences', async () => {
  const user = userEvent.setup()
  render(<NetworkSettings />)
  await manual(user, 'https://proxy.invalid:443')
  await user.click(screen.getByRole('button', { name: '测试连接' }))
  expect(testProxyConnection).toHaveBeenCalledExactlyOnceWith(
    { ...defaultProxySettings, mode: 'manual', url: 'https://proxy.invalid:443' },
    'https://www.google.com/generate_204',
  )
  expect(updateAppSettings).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().proxy).toEqual(defaultProxySettings)
  expect(toast.success).toHaveBeenCalledExactlyOnceWith('连接成功（120 ms）')
})

test('invalid proxy addresses cannot be saved or tested', async () => {
  const user = userEvent.setup()
  render(<NetworkSettings />)
  await manual(user, 'ftp://proxy.invalid')
  expect(screen.getByRole('alert')).toHaveTextContent('HTTP、HTTPS 或 SOCKS5')
  expect(screen.getByRole('button', { name: '保存并应用' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  expect(updateAppSettings).not.toHaveBeenCalled()
})

test('background tasks block applying changes but still allow testing the draft', async () => {
  useConversationStore.setState({
    backgroundSessions: new Map([
      [
        'background',
        {
          data: { ...emptyConversation, instanceId: 'background', status: 'running' },
          projectPath: 'other',
        },
      ],
    ]),
  })
  const user = userEvent.setup()
  render(<NetworkSettings />)
  await manual(user, 'http://127.0.0.1:7890')
  expect(screen.getByRole('button', { name: '保存并应用' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled()
  expect(updateAppSettings).not.toHaveBeenCalled()
})

test('failed persistence preserves the old proxy and releases the operation gate for retry', async () => {
  const previous: ProxySettings = {
    ...defaultProxySettings,
    mode: 'manual',
    url: 'http://127.0.0.1:7890',
  }
  useWorkspaceStore.setState({ proxy: previous })
  vi.mocked(updateAppSettings).mockRejectedValueOnce('数据库写入失败')
  const user = userEvent.setup()
  render(<NetworkSettings />)
  await user.clear(screen.getByRole('textbox', { name: '代理地址' }))
  await user.type(screen.getByRole('textbox', { name: '代理地址' }), 'socks5://127.0.0.1:1080')
  await user.click(screen.getByRole('button', { name: '保存并应用' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('数据库写入失败')
  expect(useWorkspaceStore.getState()).toMatchObject({
    proxy: previous,
    proxyPending: false,
    sessionActionPending: null,
  })
  expect(useConversationStore.getState().connect).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '保存并应用' }))
  await waitFor(() => expect(useWorkspaceStore.getState().proxy.mode).toBe('manual'))
  expect(useWorkspaceStore.getState().proxy.url).toBe('socks5://127.0.0.1:1080')
})

test('direct mode can override an inherited proxy without requiring an address', async () => {
  const user = userEvent.setup()
  render(<NetworkSettings />)
  await user.click(screen.getByRole('combobox', { name: '代理模式' }))
  await user.click(screen.getByRole('option', { name: '直连' }))
  expect(screen.queryByRole('textbox', { name: '代理地址' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '保存并应用' }))
  expect(updateAppSettings).toHaveBeenCalledExactlyOnceWith({
    proxy: { ...defaultProxySettings, mode: 'direct' },
  })
})

test('connection tests show pending state and failed results only in the shared toast', async () => {
  let fail!: (reason: string) => void
  vi.mocked(testProxyConnection).mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject
    }),
  )
  const user = userEvent.setup()
  render(<NetworkSettings />)
  await user.click(screen.getByRole('button', { name: '测试连接' }))
  expect(screen.getByRole('button', { name: '测试中…' })).toBeDisabled()
  await act(async () => fail('无法连接代理'))
  expect(toast.error).toHaveBeenCalledExactlyOnceWith('无法连接代理')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('browser preview does not invoke native networking', async () => {
  vi.mocked(isDesktop).mockReturnValue(false)
  render(<NetworkSettings />)
  expect(screen.getByRole('combobox', { name: '代理模式' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  expect(updateAppSettings).not.toHaveBeenCalled()
})
