import type { ComposerCommand } from '@/lib/generated/pi'

export type CompletionQuery = {
  kind: 'command' | 'file'
  query: string
  start: number
  end: number
}

export type CompletionItem = {
  value: string
  label: string
  description: string
  kind: 'command' | 'skill' | 'file'
}

export const appCommands: CompletionItem[] = [
  { value: 'new', label: '新对话', description: '在当前项目开始新对话', kind: 'command' },
  {
    value: 'resume',
    label: '切换会话',
    description: '搜索并打开已有会话',
    kind: 'command',
  },
  {
    value: 'name',
    label: '重命名',
    description: '修改当前会话标题，可在命令后输入新标题',
    kind: 'command',
  },
  {
    value: 'model',
    label: '切换模型',
    description: '选择模型，或输入 provider/model',
    kind: 'command',
  },
  {
    value: 'thinking',
    label: '思考强度',
    description: '选择强度，或输入 default、off、high 等档位',
    kind: 'command',
  },
  {
    value: 'settings',
    label: '设置',
    description: '打开 Pi Hearth 设置',
    kind: 'command',
  },
  {
    value: 'compact',
    label: '压缩上下文',
    description: '整理当前上下文，可在命令后补充保留要求',
    kind: 'command',
  },
]

export function completionQuery(text: string, start: number, end = start): CompletionQuery | null {
  if (start !== end) return null
  const slash = /^([ \t]*)\/([^\s/]*)/u.exec(text)
  if (slash) {
    const from = slash[1].length
    const to = slash[0].length
    if (start > from && start <= to)
      return { kind: 'command', query: text.slice(from + 1, start), start: from, end: to }
  }
  const before = text.slice(0, start)
  const mention = /(?:^|[\s(])@(?:"([^"\r\n]*)|([^\s@"`]*))$/u.exec(before)
  if (!mention) return null
  const from = mention.index + (mention[0].startsWith('@') ? 0 : 1)
  const quoted = mention[1] !== undefined
  const rest = text.slice(start)
  const suffix = quoted ? /^[^"\r\n]*"?/u.exec(rest)?.[0] : /^[^\s@"`]*/u.exec(rest)?.[0]
  return {
    kind: 'file',
    query: mention[1] ?? mention[2],
    start: from,
    end: start + (suffix?.length ?? 0),
  }
}

export function commandItems(skills: ComposerCommand[], query: string) {
  const items: CompletionItem[] = [
    ...appCommands,
    ...skills.map((skill) => ({
      value: skill.name,
      label: `/${skill.name}`,
      description: skill.description,
      kind: 'skill' as const,
    })),
  ]
  const term = query.toLowerCase()
  return items.filter((item) =>
    `${item.value} ${item.label} ${item.description}`.toLowerCase().includes(term),
  )
}

export function insertCompletion(text: string, query: CompletionQuery, value: string) {
  const path = /[\s"\\]/u.test(value) ? JSON.stringify(value) : value
  const inserted = query.kind === 'command' ? `/${value}` : `@${path}`
  const suffix = text.slice(query.end)
  const separator = /^\s/u.test(suffix) ? '' : ' '
  return {
    text: `${text.slice(0, query.start)}${inserted}${separator}${suffix}`,
    caret: query.start + inserted.length + (separator ? 1 : 0),
  }
}

export function slashCommand(text: string) {
  const match = /^\/([^\s/]+)(?:[ \t]+([\s\S]*))?$/u.exec(text.trim())
  return match ? { name: match[1], args: match[2]?.trim() ?? '' } : null
}
