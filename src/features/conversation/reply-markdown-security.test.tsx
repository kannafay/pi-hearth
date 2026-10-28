import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ReplyMarkdown } from './reply-markdown-content'
import { TooltipProvider } from '@/components/ui/tooltip'

test.each([false, true])('untrusted reply HTML stays inert while streaming=%s', (streaming) => {
  const text = [
    '# 正常内容',
    '<script>alert(document.cookie)</script>',
    '<iframe src="https://example.com/"></iframe>',
    '<object data="data:text/html,attack"></object>',
    '<img src="x" onerror="alert(1)">',
    '<svg onload="alert(1)"></svg>',
    '[恶意链接](javascript:alert%281%29)',
  ].join('\n\n')
  const { container } = render(
    <TooltipProvider>
      <ReplyMarkdown stateKey="untrusted" text={text} streaming={streaming} />
    </TooltipProvider>,
  )
  expect(screen.getByRole('heading', { name: '正常内容' })).toBeVisible()
  expect(container.querySelector('script, iframe, object, embed')).toBeNull()
  for (const element of container.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      expect(attribute.name).not.toMatch(/^on/i)
      if (['href', 'src', 'xlink:href'].includes(attribute.name))
        expect(attribute.value).not.toMatch(/^\s*(?:(?:java|vb)script:|data:text\/html(?:[;,]|$))/i)
    }
  }
})
