import { expect, test } from 'vitest'
import type { ChatMessage, ToolCall } from '@/lib/generated/pi'
import { buildConversationTurns } from './conversation-turns'

function message(id: string, role: string, text: string, thinking = ''): ChatMessage {
  return { id, role, text, thinking, status: 'complete', error: null }
}
const tool: ToolCall = {
  id: 'tool',
  toolCallId: 'source',
  runId: 'run',
  name: 'read',
  summary: 'notes.txt',
  arguments: '{}',
  argumentsTruncated: false,
  output: 'file contents',
  outputTruncated: false,
  status: 'complete',
  approvalId: null,
  durationMs: 10,
}

test('thoughts, intermediate text and tools stay ordered while the final answer is separate', () => {
  const messages = [
    message('user', 'user', '分析文件'),
    message('progress', 'assistant', '先读取文件。', '检查所需信息'),
    message('answer', 'assistant', '最终分析结果', '整理结论'),
  ]
  const [turn] = buildConversationTurns(
    messages,
    [tool],
    [
      { kind: 'message', id: 'user' },
      { kind: 'message', id: 'progress' },
      { kind: 'tool', id: 'tool' },
      { kind: 'message', id: 'answer' },
    ],
  )
  expect(turn.user).toBe(messages[0])
  expect(turn.reply).toBe(messages[2])
  expect(turn.process.map((item) => item.kind)).toEqual(['thinking', 'message', 'tool', 'thinking'])
  expect(turn.process.some((item) => item.kind === 'message' && item.message.id === 'answer')).toBe(
    false,
  )
})

test('each user message starts an independent turn in imported CLI history', () => {
  const messages = [
    message('u1', 'user', '第一轮'),
    message('a1', 'assistant', '答复一'),
    message('u2', 'user', '第二轮'),
    message('a2', 'assistant', '答复二'),
  ]
  const turns = buildConversationTurns(
    messages,
    [tool],
    [
      { kind: 'message', id: 'u1' },
      { kind: 'tool', id: 'tool' },
      { kind: 'message', id: 'a1' },
      { kind: 'message', id: 'u2' },
      { kind: 'message', id: 'a2' },
    ],
  )
  expect(turns).toHaveLength(2)
  expect(turns[0].process).toHaveLength(1)
  expect(turns[0].reply?.text).toBe('答复一')
  expect(turns[1].process).toHaveLength(0)
  expect(turns[1].reply?.text).toBe('答复二')
})

test('a progress statement followed by a tool is not mistaken for a final answer', () => {
  const messages = [message('u', 'user', '继续'), message('progress', 'assistant', '正在执行。')]
  const [turn] = buildConversationTurns(
    messages,
    [tool],
    [
      { kind: 'message', id: 'u' },
      { kind: 'message', id: 'progress' },
      { kind: 'tool', id: 'tool' },
    ],
  )
  expect(turn.reply).toBeNull()
  expect(turn.process.map((item) => item.kind)).toEqual(['message', 'tool'])
})

test('partial histories keep orphaned tool records, and plain chats need no process group', () => {
  const [partial] = buildConversationTurns(
    [message('answer', 'assistant', '结果')],
    [tool],
    [
      { kind: 'tool', id: 'missing' },
      { kind: 'tool', id: 'tool' },
      { kind: 'message', id: 'answer' },
    ],
  )
  expect(partial.user).toBeNull()
  expect(partial.process).toHaveLength(1)
  expect(partial.reply?.text).toBe('结果')
  const [plain] = buildConversationTurns(
    [message('u', 'user', '你好'), message('a', 'assistant', '你好。')],
    [],
    [],
  )
  expect(plain.process).toEqual([])
  expect(plain.reply?.text).toBe('你好。')
})
