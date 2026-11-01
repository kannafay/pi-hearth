import { act, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ReplyMarkdown } from './reply-markdown'

const renderer = vi.hoisted(() => {
  let resolve!: () => void
  return {
    loaded: vi.fn(),
    ready: new Promise<void>((finish) => {
      resolve = finish
    }),
    resolve: () => resolve(),
  }
})

vi.mock('./reply-markdown-content', async () => {
  renderer.loaded()
  await renderer.ready
  return {
    ReplyMarkdown: (props: { text: string; stateKey: string; streaming: boolean }) => (
      <section aria-label="格式化回复" data-state-key={props.stateKey} aria-busy={props.streaming}>
        {props.text}
      </section>
    ),
  }
})

test('replies remain readable and retain new streaming text while the rich renderer loads', async () => {
  expect(renderer.loaded).not.toHaveBeenCalled()
  const view = render(<ReplyMarkdown text="第一段" stateKey="reply" streaming />)
  expect(screen.getByText('第一段')).toBeVisible()
  expect(screen.queryByRole('region')).not.toBeInTheDocument()

  for (const [text, preview] of [
    ['\n\n第一段\n\n第二段', '第一段\n\n第二段'],
    ['\r\n \t\r\n第一段', '第一段'],
    ['\r\r第一段', '第一段'],
    ['\n    保留代码缩进\n\n    下一行', '    保留代码缩进\n\n    下一行'],
    ['    首行有缩进', '    首行有缩进'],
    ['\n \t\n', ''],
  ]) {
    view.rerender(<ReplyMarkdown text={text} stateKey="reply" streaming />)
    expect(view.container.textContent).toBe(preview)
  }

  const originalText = '\n\n第一段，第二段'
  view.rerender(<ReplyMarkdown text={originalText} stateKey="next-reply" streaming={false} />)
  expect(screen.getByText('第一段，第二段')).toBeVisible()
  expect(view.container.textContent).toBe('第一段，第二段')
  await act(async () => renderer.resolve())
  const content = await screen.findByRole('region', { name: '格式化回复' })
  expect(content).toHaveTextContent('第一段，第二段')
  expect(content.textContent).toBe(originalText)
  expect(content).toHaveAttribute('data-state-key', 'next-reply')
  expect(content).toHaveAttribute('aria-busy', 'false')
  expect(renderer.loaded).toHaveBeenCalledOnce()
})
