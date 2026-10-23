import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { ConversationProjectPicker } from './conversation-project-picker'

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }))

const projects = [
  { name: 'Hearth', path: 'D:/first/hearth' },
  { name: 'Hearth', path: 'D:/second/hearth' },
]

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.setState({
    projects,
    newConversation: vi.fn(async (projectPath) => {
      useWorkspaceStore.setState({ projectPath })
    }),
  })
})

test('a new conversation can select an exact project or use no project while preserving its draft', async () => {
  const user = userEvent.setup()
  render(<ConversationProjectPicker />)
  await user.click(screen.getByRole('button', { name: '选择对话项目' }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'Hearth D:/second/hearth' }))
  expect(useWorkspaceStore.getState().newConversation).toHaveBeenLastCalledWith(projects[1].path, {
    preserveDraft: true,
  })
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '选择对话项目' }))
  await user.click(await screen.findByRole('menuitemradio', { name: '不使用项目' }))
  expect(useWorkspaceStore.getState().newConversation).toHaveBeenLastCalledWith(null, {
    preserveDraft: true,
  })
})

test('the project picker opens project creation from the same new-conversation screen', async () => {
  const onCreateProject = vi.fn()
  const user = userEvent.setup()
  render(<ConversationProjectPicker onCreateProject={onCreateProject} />)
  await user.click(screen.getByRole('button', { name: '选择对话项目' }))
  await user.click(await screen.findByRole('menuitem', { name: '新建项目' }))
  expect(onCreateProject).toHaveBeenCalledOnce()
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
})
