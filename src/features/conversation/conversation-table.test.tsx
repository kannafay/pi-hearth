import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { toast } from '@/lib/toast'
import { ReplyMarkdown } from './reply-markdown'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const text =
  '| 文件夹 | 最近修改 |\n| :--- | ---: |\n| `docs` | 2026/6/24 |\n| 中文,目录 | 2026/10/27 |'
function content(streaming = false, source = text) {
  return (
    <TooltipProvider>
      <ReplyMarkdown stateKey="table" streaming={streaming} text={source} />
    </TooltipProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

test('streamed table keeps its DOM and formatting while actions become available on completion', () => {
  const view = render(content(true))
  const table = screen.getByRole('table')
  expect(screen.getByRole('columnheader', { name: '最近修改' })).toHaveStyle({ textAlign: 'right' })
  expect(screen.getByRole('cell', { name: 'docs' })).toBeVisible()
  for (const name of ['下载表格', '复制表格', '放大表格']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  view.rerender(content(false, text + '\n| 新目录 | 今天 |'))
  expect(screen.getByRole('table')).toBe(table)
  expect(screen.getByRole('cell', { name: '新目录' })).toBeVisible()
  for (const name of ['下载表格', '复制表格', '放大表格']) {
    expect(screen.getByRole('button', { name })).toBeEnabled()
  }
})

test('copy menu supports keyboard selection and preserves all table values as Markdown and TSV', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('ClipboardItem', undefined)
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  render(content())
  await user.click(screen.getByRole('button', { name: '复制表格' }))
  await screen.findByRole('menuitem', { name: '复制为 Markdown' })
  await user.keyboard('{ArrowDown}{Enter}')
  await waitFor(() =>
    expect(write).toHaveBeenCalledWith(
      '| 文件夹 | 最近修改 |\n| --- | --- |\n| docs | 2026/6/24 |\n| 中文,目录 | 2026/10/27 |',
    ),
  )
  expect(toast.success).toHaveBeenCalledWith('表格已复制')
  await user.click(screen.getByRole('button', { name: '复制表格' }))
  await user.click(await screen.findByRole('menuitem', { name: '复制为 TSV' }))
  expect(write).toHaveBeenLastCalledWith('文件夹\t最近修改\ndocs\t2026/6/24\n中文,目录\t2026/10/27')
})

test('streaming follows new rows, pauses when reading earlier rows, and follows the final update', () => {
  const view = render(content(true))
  const viewport = screen.getByRole('region', { name: '表格内容' })
  let height = 1000
  Object.defineProperties(viewport, {
    clientHeight: { value: 400 },
    scrollHeight: { get: () => height },
  })
  const row = '\n| 新目录 | 今天 |'
  view.rerender(content(true, text + row))
  expect(viewport.scrollTop).toBe(1000)
  viewport.scrollTop = 100
  fireEvent.scroll(viewport)
  height = 1200
  view.rerender(content(true, text + row.repeat(2)))
  expect(viewport.scrollTop).toBe(100)
  viewport.scrollTop = 800
  fireEvent.scroll(viewport)
  height = 1400
  view.rerender(content(false, text + row.repeat(3)))
  expect(viewport.scrollTop).toBe(1400)
})

test('CSV download retains Unicode and quoted values without toolbar or row metadata', async () => {
  const user = userEvent.setup()
  const create = vi.fn<(blob: Blob) => string>(() => 'blob:table')
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create
      static revokeObjectURL = vi.fn()
    },
  )
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(content())
  await user.click(screen.getByRole('button', { name: '下载表格' }))
  await user.click(await screen.findByRole('menuitem', { name: '下载为 CSV' }))
  expect(click).toHaveBeenCalledOnce()
  expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('table.csv')
  const blob = create.mock.calls[0][0]
  expect(blob.type).toBe('text/csv;charset=utf-8')
  const data = await new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
  expect([...new Uint8Array(data).slice(0, 3)]).toEqual([239, 187, 191])
  expect(new TextDecoder().decode(data)).toBe(
    '文件夹,最近修改\ndocs,2026/6/24\n"中文,目录",2026/10/27',
  )
})

test('expanded table uses the shared dialog and Escape returns focus to its trigger', async () => {
  const user = userEvent.setup()
  render(content())
  const button = screen.getByRole('button', { name: '放大表格' })
  await user.click(button)
  const dialog = await screen.findByRole('dialog', { name: '表格' })
  expect(within(dialog).getByRole('cell', { name: '中文,目录' })).toBeVisible()
  expect(within(dialog).getByRole('columnheader', { name: '最近修改' })).toHaveStyle({
    textAlign: 'right',
  })
  await waitFor(() =>
    expect(within(dialog).getByRole('region', { name: '完整表格内容' })).toHaveFocus(),
  )
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(button).toHaveFocus()
  expect(screen.getByRole('table')).toBeVisible()
})

test('clipboard failures give feedback without losing table contents', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('ClipboardItem', undefined)
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('unavailable'))
  render(content())
  await user.click(screen.getByRole('button', { name: '复制表格' }))
  await user.click(await screen.findByRole('menuitem', { name: '复制为 CSV' }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('复制表格失败，请重试。'))
  expect(screen.getByRole('cell', { name: '中文,目录' })).toBeVisible()
})
