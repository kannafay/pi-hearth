import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import { loadResourceCatalog, setResourceEnabled, openResource } from '@/lib/resources'
import { useConversationStore } from '@/features/conversation/store'
import type { ResourceCatalog } from '@/lib/generated/pi'
import { ResourceSettings } from './resource-settings'
import { useResourceCatalog } from './use-resource-catalog'

vi.mock('@/lib/desktop', () => ({ isDesktop: vi.fn(() => true) }))
vi.mock('@/lib/resources', () => ({
  loadResourceCatalog: vi.fn(),
  setResourceEnabled: vi.fn(),
  openResource: vi.fn(),
}))

const catalog: ResourceCatalog = {
  skills: [
    {
      name: 'review',
      description: '检查项目代码',
      source: 'D:/project/.pi/skills/review/SKILL.md',
      scope: 'project',
      status: 'unloaded',
      manualOnly: true,
      enabled: false,
    },
  ],
  mcp: [
    {
      name: 'docs',
      description: '远程 HTTP 服务',
      source: 'C:/agent/mcp.json',
      scope: 'global',
      status: 'disabled',
      manualOnly: false,
      enabled: false,
      configuration: '{\n  "type": "http",\n  "url": "https://example.invalid/…"\n}',
    },
  ],
  warnings: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.mocked(loadResourceCatalog).mockResolvedValue(catalog)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  vi.mocked(openResource).mockResolvedValue(undefined)
})

test('skill cards expand independently and open their directory without toggling enablement', async () => {
  const user = userEvent.setup()
  const refresh = vi.fn()
  const open = vi.fn().mockResolvedValue(undefined)
  const setEnabled = vi.fn().mockResolvedValue(undefined)
  const actions = { pending: null, open, setEnabled }
  const items = {
    ...catalog,
    skills: [
      ...catalog.skills,
      { ...catalog.skills[0], name: 'other', source: 'D:/other/SKILL.md' },
    ],
  }
  render(
    <ResourceSettings
      kind="skills"
      state={{ catalog: items, loading: false, error: null, refresh, ...actions }}
    />,
  )
  expect(screen.getByText('已启用 0 / 2 项')).toBeVisible()
  const first = screen.getByRole('button', { name: 'review' })
  const second = screen.getByRole('button', { name: 'other' })
  expect(first).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('检查项目代码')).not.toBeInTheDocument()
  expect(screen.queryByText(catalog.skills[0].source)).not.toBeInTheDocument()
  const toggle = screen.getByRole('switch', { name: '技能 review' })
  await user.click(toggle.parentElement!)
  expect(first).toHaveAttribute('aria-expanded', 'false')
  expect(setEnabled).not.toHaveBeenCalled()
  await user.click(toggle)
  expect(setEnabled).toHaveBeenCalledExactlyOnceWith('skills', catalog.skills[0], true)
  expect(first).toHaveAttribute('aria-expanded', 'false')
  await user.click(first)
  const details = within(screen.getByRole('group', { name: 'review' }))
  expect(details.getByText('检查项目代码')).toBeVisible()
  expect(details.getByText(catalog.skills[0].source)).toBeVisible()
  expect(details.getByText('当前项目')).toBeVisible()
  expect(details.getByText('仅手动调用')).toBeVisible()
  expect(open).not.toHaveBeenCalled()
  await user.click(details.getByRole('button', { name: '打开目录' }))
  expect(open).toHaveBeenCalledExactlyOnceWith('skills', catalog.skills[0])
  expect(first).toHaveAttribute('aria-expanded', 'true')
  await user.click(second)
  expect(first).toHaveAttribute('aria-expanded', 'true')
  expect(second).toHaveAttribute('aria-expanded', 'true')
  await user.click(first)
  await waitFor(() =>
    expect(screen.queryByRole('group', { name: 'review' })).not.toBeInTheDocument(),
  )
  expect(second).toHaveAttribute('aria-expanded', 'true')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

test('MCP cards show configuration and an edit action that reveals the configuration file', async () => {
  const user = userEvent.setup()
  const refresh = vi.fn()
  const open = vi.fn().mockResolvedValue(undefined)
  const setEnabled = vi.fn().mockResolvedValue(undefined)
  render(
    <ResourceSettings
      kind="mcp"
      state={{ catalog, loading: false, error: null, refresh, pending: null, open, setEnabled }}
    />,
  )
  const header = screen.getByRole('button', { name: 'docs' })
  expect(screen.queryByText(catalog.mcp[0].source)).not.toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'MCP docs' })).not.toBeChecked()
  await user.click(header)
  const details = within(screen.getByRole('group', { name: 'docs' }))
  expect(details.getByText(catalog.mcp[0].source)).toBeVisible()
  expect(details.getByText('远程 HTTP 服务')).toBeVisible()
  expect(details.getByText('连接配置')).toBeVisible()
  expect(details.getByText(/https:\/\/example\.invalid/)).toHaveTextContent('"type": "http"')
  expect(screen.queryByRole('button', { name: '打开目录' })).not.toBeInTheDocument()
  expect(open).not.toHaveBeenCalled()
  await user.click(details.getByRole('button', { name: '编辑配置' }))
  expect(open).toHaveBeenCalledExactlyOnceWith('mcp', catalog.mcp[0])
  expect(header).toHaveAttribute('aria-expanded', 'true')
  expect(setEnabled).not.toHaveBeenCalled()
  await user.click(screen.getByRole('switch', { name: 'MCP docs' }))
  expect(setEnabled).toHaveBeenCalledExactlyOnceWith('mcp', catalog.mcp[0], true)
  expect(header).toHaveAttribute('aria-expanded', 'true')
  expect(open).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: '刷新MCP列表' }))
  expect(refresh).toHaveBeenCalledOnce()
})

test.each(['skills', 'mcp'] as const)(
  '%s pending reads use the refresh button without extra loading or empty-state messages',
  (kind) => {
    const label = kind === 'skills' ? '技能' : 'MCP'
    render(
      <ResourceSettings
        kind={kind}
        state={{
          catalog: null,
          loading: true,
          error: null,
          refresh: vi.fn(),
          pending: null,
          open: vi.fn(),
          setEnabled: vi.fn(),
        }}
      />,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/^正在读取/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^未发现/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `刷新${label}列表` })).toBeDisabled()
  },
)

test('switch writes wait for backend confirmation, retain old state on failure and support retry', async () => {
  const { result } = renderHook(() => useResourceCatalog(true, true))
  await waitFor(() => expect(result.current.catalog).toEqual(catalog))
  vi.mocked(setResourceEnabled).mockRejectedValueOnce(new Error('无法重载资源'))
  await act(() => result.current.setEnabled('skills', catalog.skills[0], true))
  expect(result.current.catalog?.skills[0].enabled).toBe(false)
  expect(result.current.error).toContain('无法重载资源')
  const updated = structuredClone(catalog)
  updated.skills[0].enabled = true
  vi.mocked(setResourceEnabled).mockResolvedValueOnce(updated)
  await act(() => result.current.setEnabled('skills', catalog.skills[0], true))
  expect(result.current.catalog?.skills[0].enabled).toBe(true)
  expect(result.current.pending).toBeNull()
  expect(setResourceEnabled).toHaveBeenLastCalledWith('skills', catalog.skills[0], null, true)
  await act(() => result.current.open('skills', catalog.skills[0]))
  expect(openResource).toHaveBeenCalledExactlyOnceWith('skills', catalog.skills[0], null)
})

test('resource tabs share one bounded result and refresh reads new configuration', async () => {
  const { result, rerender } = renderHook(({ active }) => useResourceCatalog(true, active), {
    initialProps: { active: false },
  })
  expect(loadResourceCatalog).not.toHaveBeenCalled()
  rerender({ active: true })
  await waitFor(() => expect(result.current.catalog).toEqual(catalog))
  rerender({ active: false })
  rerender({ active: true })
  expect(loadResourceCatalog).toHaveBeenCalledExactlyOnceWith(null)
  vi.mocked(loadResourceCatalog).mockResolvedValueOnce({ skills: [], mcp: [], warnings: [] })
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.catalog?.skills).toEqual([]))
  expect(loadResourceCatalog).toHaveBeenCalledTimes(2)
})

test('late responses cannot show resources from a previously selected project', async () => {
  let finish!: (value: ResourceCatalog) => void
  vi.mocked(loadResourceCatalog).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  useWorkspaceStore.setState({ projectPath: 'D:/old' })
  const { result } = renderHook(() => useResourceCatalog(true, true))
  expect(result.current.loading).toBe(true)
  const next = { skills: [], mcp: [], warnings: [] }
  vi.mocked(loadResourceCatalog).mockResolvedValueOnce(next)
  act(() => useWorkspaceStore.setState({ projectPath: 'D:/new' }))
  await waitFor(() => expect(result.current.catalog).toEqual(next))
  await act(async () => finish(catalog))
  expect(result.current.catalog).toEqual(next)
  expect(loadResourceCatalog).toHaveBeenLastCalledWith('D:/new')
})

test('errors can be retried and browser previews never invoke native discovery', async () => {
  vi.mocked(loadResourceCatalog).mockRejectedValueOnce(new Error('无法读取配置'))
  const view = renderHook(() => useResourceCatalog(true, true))
  await waitFor(() => expect(view.result.current.error).toContain('无法读取配置'))
  expect(view.result.current.loading).toBe(false)
  act(() => view.result.current.refresh())
  await waitFor(() => expect(view.result.current.catalog).toEqual(catalog))
  view.unmount()
  vi.mocked(loadResourceCatalog).mockClear()
  vi.mocked(isDesktop).mockReturnValue(false)
  const preview = renderHook(() => useResourceCatalog(true, true))
  expect(preview.result.current.error).toBe('请在桌面应用中查看本机资源。')
  expect(preview.result.current.loading).toBe(false)
  expect(loadResourceCatalog).not.toHaveBeenCalled()
})
