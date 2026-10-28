import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ReplyMarkdown } from './reply-markdown-content'
import { ConversationLocalState } from './conversation-local-state'
import { TooltipProvider } from '@/components/ui/tooltip'

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

test('finishing a reply retains the code disclosure DOM and its default expansion', () => {
  const text = '代码如下：\n\n```text\n第一段代码\n```\n\n补充说明。'
  const content = (streaming: boolean) => (
    <ReplyMarkdown stateKey="reply" text={text} streaming={streaming} />
  )
  const view = render(content(true))
  const trigger = screen.getByRole('button', { name: 'text' })
  const root = trigger.closest('[data-slot="collapsible"]')
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  view.rerender(content(false))
  expect(screen.getByRole('button', { name: 'text' })).toBe(trigger)
  expect(trigger.closest('[data-slot="collapsible"]')).toBe(root)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('第一段代码')).toBeVisible()
  expect(screen.getByRole('button', { name: '复制代码' })).toBeEnabled()
})

test('manual code folding survives reply completion and virtual row remounts independently', async () => {
  const local = new Map<string, unknown>()
  const text = '```text\n第一段代码\n```\n\n中间段落。\n\n```text\n第二段代码\n```'
  const content = (streaming = false) => (
    <TooltipProvider>
      <ConversationLocalState initial={local}>
        <ReplyMarkdown stateKey="reply" text={text} streaming={streaming} />
      </ConversationLocalState>
    </TooltipProvider>
  )
  const user = userEvent.setup()
  const view = render(content(true))
  await user.click(screen.getAllByRole('button', { name: 'text' })[1])
  expect(screen.getAllByRole('button', { name: 'text' })[0]).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  view.rerender(content())
  expect(screen.getAllByRole('button', { name: 'text' })[1]).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  view.unmount()
  render(content())
  expect(screen.getAllByRole('button', { name: 'text' })[0]).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  expect(screen.getAllByRole('button', { name: 'text' })[1]).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await waitFor(() => expect(screen.queryByText('第二段代码')).not.toBeInTheDocument())
})

test('completed replies retain headings, lists, tables and reference links with the stable renderer', () => {
  const text =
    '# 标题\n\n普通段落与 `code`。\n\n1. 第一项\n2. 第二项\n\n| 列名 | 值 |\n| --- | --- |\n| 测试 | 内容 |\n\n[参考说明][guide]\n\n[guide]: https://example.com/guide'
  render(
    <TooltipProvider>
      <ReplyMarkdown stateKey="reply" text={text} streaming={false} />
    </TooltipProvider>,
  )
  expect(screen.getByRole('heading', { name: '标题' })).toBeVisible()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByRole('cell', { name: '内容' })).toBeVisible()
  expect(screen.getByRole('button', { name: '参考说明' })).toHaveAttribute(
    'data-incomplete',
    'false',
  )
})

test('a later reply does not inherit an earlier code block folding when it finishes', async () => {
  const text = '```text\n代码\n```'
  const user = userEvent.setup()
  const content = (stateKey: string, streaming: boolean) => (
    <TooltipProvider>
      <ReplyMarkdown stateKey={stateKey} text={text} streaming={streaming} />
    </TooltipProvider>
  )
  const view = render(content('earlier', false))
  await user.click(screen.getByRole('button', { name: 'text' }))
  expect(screen.getByRole('button', { name: 'text' })).toHaveAttribute('aria-expanded', 'false')
  view.rerender(content('later', true))
  const later = screen.getByRole('button', { name: 'text' })
  view.rerender(content('later', false))
  expect(screen.getByRole('button', { name: 'text' })).toBe(later)
  expect(later).toHaveAttribute('aria-expanded', 'true')
})
