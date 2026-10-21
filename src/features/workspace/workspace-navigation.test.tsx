import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '@/app/store'
import { useConversationStore } from '@/features/conversation/store'
import { WorkspaceNavigation } from './workspace-navigation'

const project = { path: 'D:/projects/hearth', name: 'Hearth' }

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  useConversationStore.setState({ status: 'ready' })
})

test('project menu actions fire and close the menu', async () => {
  const onCreate = vi.fn()
  const user = userEvent.setup()
  render(
    <WorkspaceNavigation
      desktop
      onAdd={vi.fn()}
      onCreate={onCreate}
      onSettings={vi.fn()}
      onSearch={vi.fn()}
      onInstructions={vi.fn()}
    />,
  )
  await user.click(screen.getByRole('button', { name: '项目操作' }))
  await user.click(await screen.findByRole('menuitem', { name: '创建项目' }))
  expect(onCreate).toHaveBeenCalledOnce()
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
})

test('projects expand their sessions and their instruction menu remains usable', async () => {
  useWorkspaceStore.setState({
    projects: [project],
    sessions: [
      {
        path: 'D:/sessions/one.jsonl',
        id: 'one',
        cwd: project.path,
        title: '设计讨论',
        modified: Date.now(),
        messageCount: 2,
      },
    ],
  })
  const onInstructions = vi.fn()
  const user = userEvent.setup()
  render(
    <WorkspaceNavigation
      desktop
      onAdd={vi.fn()}
      onCreate={vi.fn()}
      onSettings={vi.fn()}
      onSearch={vi.fn()}
      onInstructions={onInstructions}
    />,
  )
  const trigger = screen.getByRole('button', { name: 'Hearth' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: /设计讨论/ })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Hearth 项目菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '项目指令' }))
  expect(onInstructions).toHaveBeenCalledExactlyOnceWith(project)
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('button', { name: /设计讨论/ })).not.toBeInTheDocument()
})

test('sliding filters and search stay usable while a session is connecting', async () => {
  const openSession = vi.fn()
  const newConversation = vi.fn()
  const onSearch = vi.fn()
  useWorkspaceStore.setState({
    projects: [project],
    projectPath: project.path,
    generalCwd: 'general',
    sessions: [
      {
        path: 'project.jsonl',
        id: 'project',
        cwd: project.path,
        title: '项目会话',
        modified: Date.now(),
        messageCount: 2,
      },
      {
        path: 'chat.jsonl',
        id: 'chat',
        cwd: 'general',
        title: '普通会话',
        modified: Date.now(),
        messageCount: 2,
      },
    ],
    openSession,
    newConversation,
  })
  useConversationStore.setState({ status: 'connecting' })
  const user = userEvent.setup()
  render(
    <WorkspaceNavigation
      desktop
      onAdd={vi.fn()}
      onCreate={vi.fn()}
      onSettings={vi.fn()}
      onSearch={onSearch}
      onInstructions={vi.fn()}
    />,
  )
  expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true')
  await user.click(screen.getByRole('tab', { name: '聊天' }))
  expect(screen.queryByRole('region', { name: '项目' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /普通会话/ }))
  expect(openSession).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('tab', { name: '项目' }))
  expect(screen.queryByRole('button', { name: /普通会话/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '搜索会话' }))
  expect(onSearch).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: '新建聊天' }))
  expect(newConversation).toHaveBeenCalledWith(null)
})
