import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import { searchSessions } from '@/lib/workspace'
import type { SessionSearchResult } from '@/lib/generated/pi'
import { SessionSearchDialog } from './session-search-dialog'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))
vi.mock('@/lib/workspace', () => ({ searchSessions: vi.fn() }))
const result: SessionSearchResult = {
  session: {
    path: 'one.jsonl',
    id: 'one',
    cwd: 'project',
    title: '设计讨论',
    modified: Date.now(),
    messageCount: 4,
  },
  projectName: 'Hearth',
  snippet: '这里有正文关键词',
  matchedIn: 'content',
}

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ status: 'connecting' })
})

test('body search highlights the snippet and Enter opens its exact native session while connecting', async () => {
  vi.mocked(searchSessions).mockResolvedValue([result])
  const openSession = vi.fn()
  const onClose = vi.fn()
  useWorkspaceStore.setState({ openSession })
  const user = userEvent.setup()
  render(<SessionSearchDialog onClose={onClose} />)
  const input = screen.getByRole('combobox')
  await waitFor(() => expect(input).toHaveFocus())
  await user.type(input, '关键词')
  const option = await screen.findByRole('option', { name: /设计讨论/ })
  expect(searchSessions).toHaveBeenLastCalledWith('关键词')
  expect(option.querySelector('mark')).toHaveTextContent('关键词')
  await user.keyboard('{Enter}')
  expect(openSession).toHaveBeenCalledWith(result.session)
  expect(onClose).toHaveBeenCalledOnce()
})

test('a slow old search cannot overwrite newer results, and Escape closes the dialog', async () => {
  let oldResult!: (result: SessionSearchResult[]) => void
  vi.mocked(searchSessions).mockImplementation((query) =>
    query === '旧词'
      ? new Promise((resolve) => {
          oldResult = resolve
        })
      : Promise.resolve([{ ...result, session: { ...result.session, title: '新结果' } }]),
  )
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(<SessionSearchDialog onClose={onClose} />)
  const input = screen.getByRole('combobox')
  await user.type(input, '旧词')
  await waitFor(() => expect(searchSessions).toHaveBeenCalledWith('旧词'))
  await user.clear(input)
  await user.type(input, '新词')
  await screen.findByRole('option', { name: /新结果/ })
  await act(async () => {
    oldResult([result])
  })
  expect(screen.queryByRole('option', { name: /设计讨论/ })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledOnce()
})
