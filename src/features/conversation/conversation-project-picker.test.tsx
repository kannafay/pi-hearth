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
  await user.click(screen.getByRole('combobox', { name: '选择对话项目' }))
  expect(await screen.findByRole('combobox', { name: '搜索项目名称或路径' })).toHaveFocus()
  await user.click(await screen.findByRole('option', { name: 'Hearth D:/second/hearth' }))
  expect(useWorkspaceStore.getState().newConversation).toHaveBeenLastCalledWith(projects[1].path, {
    preserveDraft: true,
  })
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  await user.click(screen.getByRole('combobox', { name: '选择对话项目' }))
  await user.click(await screen.findByRole('option', { name: '不使用项目' }))
  expect(useWorkspaceStore.getState().newConversation).toHaveBeenLastCalledWith(null, {
    preserveDraft: true,
  })
})

test('the project picker opens project creation from the same new-conversation screen', async () => {
  const onCreateProject = vi.fn()
  const user = userEvent.setup()
  render(<ConversationProjectPicker onCreateProject={onCreateProject} />)
  await user.click(screen.getByRole('combobox', { name: '选择对话项目' }))
  await user.click(await screen.findByRole('button', { name: '新建项目' }))
  expect(onCreateProject).toHaveBeenCalledOnce()
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
})

test('search matches names and Windows paths, supports keyboard selection, and resets when reopened', async () => {
  const user = userEvent.setup()
  render(<ConversationProjectPicker />)
  await user.click(screen.getByRole('combobox', { name: '选择对话项目' }))
  const input = await screen.findByRole('combobox', { name: '搜索项目名称或路径' })
  await user.type(input, 'SECOND\\HEARTH')
  expect(await screen.findByRole('option', { name: 'Hearth D:/second/hearth' })).toBeVisible()
  expect(screen.queryByRole('option', { name: 'Hearth D:/first/hearth' })).not.toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(useWorkspaceStore.getState().newConversation).toHaveBeenLastCalledWith(projects[1].path, {
    preserveDraft: true,
  })
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  await user.click(screen.getByRole('combobox', { name: '选择对话项目' }))
  expect(await screen.findByRole('combobox', { name: '搜索项目名称或路径' })).toHaveValue('')
  expect(screen.getAllByRole('option')).toHaveLength(3)
})

test('an empty search keeps project creation available and clearing it restores the full list', async () => {
  const user = userEvent.setup()
  render(<ConversationProjectPicker onCreateProject={vi.fn()} />)
  await user.click(screen.getByRole('combobox', { name: '选择对话项目' }))
  const input = await screen.findByRole('combobox', { name: '搜索项目名称或路径' })
  await user.type(input, '不存在的项目')
  expect(await screen.findByText('没有匹配的项目')).toBeVisible()
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '新建项目' })).toBeEnabled()
  await user.clear(input)
  expect(screen.getAllByRole('option')).toHaveLength(3)
})
