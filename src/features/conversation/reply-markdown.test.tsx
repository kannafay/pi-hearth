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

  view.rerender(<ReplyMarkdown text="第一段，第二段" stateKey="next-reply" streaming={false} />)
  expect(screen.getByText('第一段，第二段')).toBeVisible()
  await act(async () => renderer.resolve())
  const content = await screen.findByRole('region', { name: '格式化回复' })
  expect(content).toHaveTextContent('第一段，第二段')
  expect(content).toHaveAttribute('data-state-key', 'next-reply')
  expect(content).toHaveAttribute('aria-busy', 'false')
  expect(renderer.loaded).toHaveBeenCalledOnce()
})
