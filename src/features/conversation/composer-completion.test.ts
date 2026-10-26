import { expect, test } from 'vitest'
import {
  commandItems,
  completionQuery,
  insertCompletion,
  slashCommand,
} from './composer-completion'

test('commands complete only the first token and preserve existing arguments', () => {
  const text = '  /mod 保留参数'
  const query = completionQuery(text, 6)!
  expect(query).toEqual({ kind: 'command', start: 2, end: 6, query: 'mod' })
  expect(insertCompletion(text, query, 'model').text).toBe('  /model 保留参数')
  expect(completionQuery('/model high', 11)).toBeNull()
  expect(completionQuery('请用 /model', 9)).toBeNull()
  expect(completionQuery('/tmp/file.ts', 12)).toBeNull()
  expect(completionQuery('/model', 2, 5)).toBeNull()
})

test('file completion uses the caret, quotes spaces and keeps surrounding prose', () => {
  const text = '阅读 @src/old 后继续'
  const query = completionQuery(text, text.indexOf('old') + 1)!
  expect(query).toEqual({ kind: 'file', start: 3, end: 11, query: 'src/o' })
  expect(insertCompletion(text, query, 'src/中文 目录/notes.ts').text).toBe(
    '阅读 @"src/中文 目录/notes.ts" 后继续',
  )
  expect(completionQuery('联系 a@example.com', 16)).toBeNull()
  expect(completionQuery('https://host/@name', 18)).toBeNull()
  expect(completionQuery('`@file`', 6)).toBeNull()
})

test('quoted references replace the entire token including a closing quote', () => {
  const text = '看 @"my @file.ts" 然后继续'
  const query = completionQuery(text, text.indexOf('file') + 2)!
  expect(query.start).toBe(2)
  expect(insertCompletion(text, query, 'my @file.ts').text).toBe(text)
})

test('command search includes Chinese descriptions and only supplied loaded skills', () => {
  const skills = [{ name: 'skill:design', description: 'Design a frontend' }]
  expect(commandItems(skills, '模型').map((item) => item.value)).toEqual(['model'])
  expect(commandItems(skills, 'frontend').map((item) => item.value)).toEqual(['skill:design'])
  expect(commandItems([], 'skill:')).toEqual([])
})

test('slash dispatch distinguishes arguments and filesystem paths', () => {
  expect(slashCommand('/thinking Off')).toEqual({ name: 'thinking', args: 'Off' })
  expect(slashCommand('/compact 保留这些内容\n以及路径')).toEqual({
    name: 'compact',
    args: '保留这些内容\n以及路径',
  })
  expect(slashCommand('/src/file.ts')).toBeNull()
  expect(slashCommand('请执行 /new')).toBeNull()
})
