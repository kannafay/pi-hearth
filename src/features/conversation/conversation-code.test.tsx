import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Streamdown } from 'streamdown'
import { ConversationCode, ConversationCodeState } from './conversation-code'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConversationLocalState } from './conversation-local-state'

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

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
beforeEach(() => {
  // jsdom does not provide the native scrolling used by streaming code auto-follow.
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  vi.unstubAllGlobals()
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

test('the themed tooltip preserves copy clicks and copies the exact source without line numbers', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const { container } = view()
  await user.click(screen.getByRole('button', { name: '复制代码' }))
  expect(write).toHaveBeenCalledWith(source)
  expect(screen.getByText('已复制')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'typescript' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
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
  expect(screen.getByRole('button', { name: 'unknown-language' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  expect(screen.getByRole('button', { name: '复制代码' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '下载代码' })).toBeDisabled()
  rerender(
    <Streamdown components={components} mode="static">
      {'```unknown-language\n  <hello>&\n```'}
    </Streamdown>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '复制代码' })).toBeEnabled())
  expect(screen.getByRole('button', { name: '下载代码' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'unknown-language' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  expect(screen.getByText('<hello>&')).toBeInTheDocument()
})

test('code stays expanded through a closed fence and reply completion until manually folded', async () => {
  const user = userEvent.setup()
  const content = (text: string, streaming: boolean) => (
    <Streamdown components={components} mode="streaming" isAnimating={streaming}>
      {text}
    </Streamdown>
  )
  const view = render(content('```typescript\nconst first = 1', true))
  expect(screen.getByRole('button', { name: 'typescript' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  view.rerender(content('```typescript\nconst first = 1\n```\n\n继续解释代码。', true))
  expect(screen.getByRole('button', { name: 'typescript' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  view.rerender(content('```typescript\nconst first = 1\n```\n\n解释完成。', false))
  const trigger = screen.getByRole('button', { name: 'typescript' })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('const first = 1')).toBeVisible()
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await waitFor(() => expect(screen.queryByText('const first = 1')).not.toBeInTheDocument())
  view.rerender(content('```typescript\nconst first = 1\n```\n\n增加说明。', false))
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

test('each finished code block remembers its own expansion across virtual row remounts', async () => {
  const user = userEvent.setup()
  const local = new Map<string, unknown>()
  const text = '```text\n第一段代码\n```\n\n```text\n第二段代码\n```'
  const content = (stateKey = 'reply') => (
    <ConversationLocalState initial={local}>
      <ConversationCodeState stateKey={stateKey}>
        <Streamdown components={components} mode="static">
          {text}
        </Streamdown>
      </ConversationCodeState>
    </ConversationLocalState>
  )
  const view = render(content())
  const triggers = screen.getAllByRole('button', { name: 'text' })
  await user.click(triggers[1])
  expect(triggers[0]).toHaveAttribute('aria-expanded', 'true')
  expect(triggers[1]).toHaveAttribute('aria-expanded', 'false')
  view.unmount()
  const restored = render(content())
  expect(screen.getAllByRole('button', { name: 'text' })[0]).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  expect(screen.getAllByRole('button', { name: 'text' })[1]).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  restored.unmount()
  render(content('another-reply'))
  expect(
    screen
      .getAllByRole('button', { name: 'text' })
      .every((trigger) => trigger.getAttribute('aria-expanded') === 'true'),
  ).toBe(true)
})

test('a manually folded streaming block stays folded as code arrives and reopens with the keyboard', async () => {
  const user = userEvent.setup()
  const content = (text: string, streaming = true) => (
    <Streamdown components={components} mode="streaming" isAnimating={streaming}>
      {text}
    </Streamdown>
  )
  const { rerender } = render(content('```text\n开头'))
  const trigger = screen.getByRole('button', { name: 'text' })
  await user.click(trigger)
  await waitFor(() => expect(screen.queryByText('开头')).not.toBeInTheDocument())
  rerender(content('```text\n再次增加的内容'))
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('再次增加的内容')).not.toBeInTheDocument()
  rerender(content('```text\n再次增加的内容\n```', false))
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.keyboard(' ')
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('再次增加的内容')).toBeVisible()
})
