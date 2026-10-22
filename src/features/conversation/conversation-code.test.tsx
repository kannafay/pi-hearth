import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { Streamdown } from 'streamdown'
import { ConversationCode } from './conversation-code'
import { TooltipProvider } from '@/components/ui/tooltip'

const source = 'function add(a: number, b: number) {\n  return a + b;\n}\n'
const markdown = `行内代码 \`add(1, 2)\`\n\n\`\`\`typescript\n${source}\`\`\``
const components = { code: ConversationCode }

function view(text = markdown, streaming = false) {
  return render(
    <TooltipProvider>
      <Streamdown
        components={components}
        mode={streaming ? 'streaming' : 'static'}
        isAnimating={streaming}
        translations={{ copied: '已复制' }}
      >
        {text}
      </Streamdown>
    </TooltipProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

test('the themed tooltip preserves copy clicks and copies the exact source without line numbers', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const { container } = view()
  await user.click(screen.getByRole('button', { name: '复制代码' }))
  expect(write).toHaveBeenCalledWith(source)
  expect(screen.getByText('已复制')).toBeInTheDocument()
  expect(screen.getAllByRole('button')).toHaveLength(2)
  expect(container.querySelector('[data-streamdown="inline-code"]')).toHaveTextContent('add(1, 2)')
  expect(screen.getByRole('button', { name: '复制代码' })).not.toHaveAttribute('title')
})

test('download preserves the language extension and original source through the tooltip', async () => {
  const user = userEvent.setup()
  const create = vi.fn<(blob: Blob) => string>(() => 'blob:code-preview')
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create
      static revokeObjectURL = vi.fn()
    },
  )
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  view()
  await user.click(screen.getByRole('button', { name: '下载代码' }))
  expect(click).toHaveBeenCalledOnce()
  const link = click.mock.instances[0] as HTMLAnchorElement
  expect(link.download).toBe('file.ts')
  expect(link.href).toBe('blob:code-preview')
  const blob = create.mock.calls[0][0] as Blob
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
  expect(text).toBe(source)
})

test('incomplete streaming code stays visible and actions become usable after completion', async () => {
  const { rerender } = view('```unknown-language\n  <hello>&', true)
  expect(screen.getByText('unknown-language')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '复制代码' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '下载代码' })).toBeDisabled()
  rerender(
    <Streamdown components={components} mode="static">
      {'```unknown-language\n  <hello>&\n```'}
    </Streamdown>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '复制代码' })).toBeEnabled())
  expect(screen.getByRole('button', { name: '下载代码' })).toBeEnabled()
  expect(screen.getByText('<hello>&')).toBeInTheDocument()
})
