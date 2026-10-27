import { expect, test } from 'vitest'
import type { ChatMessage, ToolCall } from '@/lib/generated/pi'
import { buildConversationTurns, createConversationViewSelector } from './conversation-turns'

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

test('context summaries stay separate from replies and later progress in timeline order', () => {
  const messages = [
    message('u', 'user', '任务'),
    message('a', 'assistant', '上下文摘要\n\n这仍是一条普通回复。'),
    message('summary', 'compactionSummary', 'Compressed context'),
    message('branch', 'branchSummary', 'Branch context'),
    message('next', 'assistant', '继续执行'),
  ]
  const turns = buildConversationTurns(messages, [], [])
  expect(turns.map(({ id }) => id)).toEqual(['u', 'summary', 'branch', 'process-next'])
  expect(turns[0].reply).toBe(messages[1])
  expect(turns[0].summary).toBeNull()
  expect(turns[1]).toMatchObject({
    user: null,
    reply: null,
    lastAssistant: null,
    process: [],
    summary: messages[2],
  })
  expect(turns[2].summary).toBe(messages[3])
  expect(turns[3].reply).toBe(messages[4])
  const select = createConversationViewSelector()
  const initial = { ...transcript(0), messages }
  const before = select(initial)
  const updated = { ...messages[2], text: 'Updated context' }
  const after = select({
    ...initial,
    messages: messages.map((item) => (item.id === updated.id ? updated : item)),
  })
  expect(after.turns.get('summary')?.summary).toBe(updated)
  expect(after.turns.get('u')).toBe(before.turns.get('u'))
})

function transcript(count: number) {
  const messages = Array.from({ length: count }, (_, index) => [
    message(`u${index}`, 'user', `问题 ${index}`),
    message(`a${index}`, 'assistant', `回复 ${index}`),
  ]).flat()
  return {
    sessionFile: 'history.jsonl',
    instanceId: 'pi-1',
    messages,
    tools: [] as ToolCall[],
    timeline: messages.map(({ id }) => ({ kind: 'message', id })),
  }
}

test('streaming text, thoughts and tool output preserve every historical turn and the ID list', () => {
  const select = createConversationViewSelector()
  let state = transcript(1000)
  const initial = select(state)
  for (let index = 0; index < 40; index++) {
    state = {
      ...state,
      messages: state.messages.map((item) =>
        item.id === 'a999'
          ? { ...item, text: item.text + '新内容', thinking: item.thinking + '思考' }
          : item,
      ),
    }
    const next = select(state)
    expect(next.ids).toBe(initial.ids)
    for (let history = 0; history < 999; history++)
      expect(next.turns.get(`u${history}`)).toBe(initial.turns.get(`u${history}`))
    expect(next.turns.get('u999')?.reply?.text).toContain('新内容')
  }
  state = {
    ...state,
    tools: [tool],
    timeline: [...state.timeline, { kind: 'tool', id: tool.id }],
  }
  const withTool = select(state)
  expect(withTool.ids).toBe(initial.ids)
  state = { ...state, tools: [{ ...tool, output: '增量工具输出' }] }
  const next = select(state)
  expect(next.turns.get('u0')).toBe(initial.turns.get('u0'))
  expect(next.turns.get('u999')).not.toBe(withTool.turns.get('u999'))
  expect([...next.turns.values()]).toEqual(
    buildConversationTurns(state.messages, state.tools, state.timeline),
  )
  expect(initial.turns.get('u999')?.reply?.text).toBe('回复 999')
  expect(withTool.turns.get('u999')?.process.at(-1)).toMatchObject({
    tool: { output: tool.output },
  })
})

test('append, rewrite truncation and session changes keep grouping correct without mutating snapshots', () => {
  const select = createConversationViewSelector()
  const first = transcript(2)
  const initial = select(first)
  const appended = transcript(3)
  appended.messages.splice(0, 4, ...first.messages)
  const added = select(appended)
  expect(added.ids).toEqual(['u0', 'u1', 'u2'])
  expect(added.turns.get('u0')).toBe(initial.turns.get('u0'))
  // React can read an earlier snapshot while a later one is already cached.
  expect(select(first)).toBe(initial)
  const rewritten = {
    ...appended,
    messages: [first.messages[0], message('replacement', 'assistant', '重新回答')],
    timeline: [first.timeline[0], { kind: 'message', id: 'replacement' }],
  }
  expect(select(rewritten).ids).toEqual(['u0'])
  expect(select(rewritten).turns.get('u0')?.reply?.text).toBe('重新回答')
  expect(added.ids).toHaveLength(3)
  expect(initial.turns.get('u0')?.reply?.text).toBe('回复 0')
  const switched = select({ ...first, sessionFile: 'another.jsonl' })
  expect(switched.ids).not.toBe(initial.ids)
  expect(switched.turns.get('u0')).not.toBe(initial.turns.get('u0'))
})

test('same-size history replacements and reads of old snapshots do not leave stale message locations', () => {
  const select = createConversationViewSelector()
  const first = transcript(1)
  const initial = select(first)
  const replacement = {
    ...first,
    timeline: [],
    messages: [message('new-user', 'user', '新的问题'), message('new-ai', 'assistant', '新回复')],
  }
  expect(select(replacement).ids).toEqual(['new-user'])
  select(first)
  const next = select({
    ...replacement,
    messages: [replacement.messages[0], { ...replacement.messages[1], text: '新回复继续' }],
  })
  expect(next.turns.get('new-user')?.reply?.text).toBe('新回复继续')
  expect(initial.turns.get('u0')?.reply?.text).toBe('回复 0')
})
