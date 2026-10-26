import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { isDesktop } from '@/lib/desktop'
import { loadResourceCatalog } from '@/lib/resources'
import type { ResourceCatalog } from '@/lib/generated/pi'
import { ResourceSettings } from './resource-settings'
import { useResourceCatalog } from './use-resource-catalog'

vi.mock('@/lib/desktop', () => ({ isDesktop: vi.fn(() => true) }))
vi.mock('@/lib/resources', () => ({ loadResourceCatalog: vi.fn() }))

const catalog: ResourceCatalog = {
  skills: [
    {
      name: 'review',
      description: '检查项目代码',
      source: 'D:/project/.pi/skills/review/SKILL.md',
      scope: 'project',
      status: 'unloaded',
      manualOnly: true,
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
    },
  ],
  warnings: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.mocked(loadResourceCatalog).mockResolvedValue(catalog)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
})

test('read-only groups show scope, source and actual loading status', async () => {
  const user = userEvent.setup()
  const refresh = vi.fn()
  const view = render(
    <ResourceSettings kind="skills" state={{ catalog, loading: false, error: null, refresh }} />,
  )
  expect(screen.getByText('0 项')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '当前项目' }))
  expect(screen.getByText('review')).toBeVisible()
  expect(screen.getByText('未加载')).toBeVisible()
  expect(screen.getByText(catalog.skills[0].source)).toBeVisible()
  expect(screen.getByText('调用方式：仅手动调用')).toBeVisible()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  view.rerender(
    <ResourceSettings kind="mcp" state={{ catalog, loading: false, error: null, refresh }} />,
  )
  await user.click(screen.getByRole('button', { name: '全局' }))
  expect(screen.getByText('配置已禁用')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '刷新MCP列表' }))
  expect(refresh).toHaveBeenCalledOnce()
})

test('a pending read never flashes an empty-state message', () => {
  render(
    <ResourceSettings
      kind="skills"
      state={{ catalog: null, loading: true, error: null, refresh: vi.fn() }}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('正在读取技能列表')
  expect(screen.queryByText('未发现技能。')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '刷新技能列表' })).toBeDisabled()
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
