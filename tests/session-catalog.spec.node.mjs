import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  catalog,
  history,
  renameSession,
  searchDocuments,
  sessionDirectory,
} from '../runtime/session-catalog.mjs'

await mkdir('work', { recursive: true })
const root = await mkdtemp(path.resolve('work', 'session-test-'))
const agent = path.join(root, 'agent')
const first = path.join(root, '项目一')
const second = path.join(root, '项目二')
const legacy = path.join(root, 'legacy')
for (const directory of [agent, first, second, legacy]) await mkdir(directory)
process.env.PI_CODING_AGENT_DIR = agent
delete process.env.PI_CODING_AGENT_SESSION_DIR
const sdk = await import(
  pathToFileURL(
    path.resolve('node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js'),
  ).href
)
function session(cwd, name, directory) {
  const manager = sdk.SessionManager.create(cwd, directory)
  manager.appendMessage({ role: 'user', content: name, timestamp: Date.now() })
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: `${name} reply` }],
    stopReason: 'stop',
    timestamp: Date.now(),
  })
  manager.appendSessionInfo(name)
  return manager
}

test('all native project sessions and existing desktop sessions are discovered without copying', async () => {
  const a = session(first, 'CLI one')
  const b = session(first, 'CLI two')
  const c = session(second, 'second project')
  const old = session(first, 'desktop legacy', legacy)
  const found = await catalog({ legacyDir: legacy, projects: [first, second] }, sdk, agent)
  assert.equal(found.length, 4)
  assert.deepEqual(
    new Set(found.map((item) => item.id)),
    new Set([a, b, c, old].map((item) => item.getSessionId())),
  )
  assert.equal(await sessionDirectory(first, agent, sdk), a.getSessionDir())
  a.appendMessage({ role: 'user', content: 'CLI added', timestamp: Date.now() })
  const updated = await catalog({ legacyDir: legacy, projects: [] }, sdk, agent)
  assert.ok(
    updated.find((item) => item.id === a.getSessionId()).messageCount >
      found.find((item) => item.id === a.getSessionId()).messageCount,
  )
})

test('history keeps the native active branch and tools without modifying its file', async () => {
  const manager = session(first, 'branch test')
  const branchPoint = manager.appendMessage({
    role: 'user',
    content: 'choose branch',
    timestamp: Date.now(),
  })
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'abandoned answer' }],
    timestamp: Date.now(),
  })
  manager.branch(branchPoint)
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'a.txt' } }],
    stopReason: 'toolUse',
    timestamp: Date.now(),
  })
  manager.appendMessage({
    role: 'toolResult',
    toolCallId: 'tool-1',
    toolName: 'read',
    content: [{ type: 'text', text: 'file result' }],
    isError: false,
    timestamp: Date.now(),
  })
  const file = manager.getSessionFile()
  const before = await readFile(file, 'utf8')
  const messages = await history(file, sdk)
  assert.ok(messages.some((item) => item.role === 'toolResult' && item.toolCallId === 'tool-1'))
  assert.ok(messages.every((item) => Number.isFinite(item.__hearthFinishedAt)))
  assert.equal(JSON.stringify(messages).includes('abandoned answer'), false)
  assert.equal(await readFile(file, 'utf8'), before)
  const [document, missing] = await searchDocuments([file, `${file}.missing`], sdk)
  assert.ok(document.texts.includes('choose branch'))
  assert.equal(
    document.texts.some(
      (text) => text.includes('abandoned answer') || text.includes('file result'),
    ),
    false,
  )
  assert.deepEqual(missing.texts, [])
  assert.equal(await readFile(file, 'utf8'), before)
})

test('custom project session locations and environment overrides follow Pi storage', async () => {
  await mkdir(path.join(second, '.pi'))
  const custom = path.join(root, 'custom')
  await mkdir(custom)
  await writeFile(path.join(second, '.pi/settings.json'), JSON.stringify({ sessionDir: custom }))
  const manager = session(second, 'custom location', custom)
  assert.equal(await sessionDirectory(second, agent, sdk), custom)
  const found = await catalog({ legacyDir: legacy, projects: [second] }, sdk, agent)
  assert.ok(found.some((item) => item.id === manager.getSessionId()))
  process.env.PI_CODING_AGENT_SESSION_DIR = legacy
  assert.equal(await sessionDirectory(second, agent, sdk), legacy)
  delete process.env.PI_CODING_AGENT_SESSION_DIR
})

test('renaming appends native metadata, preserves history and survives reload and later messages', async () => {
  const manager = session(first, 'original title')
  const file = manager.getSessionFile()
  const before = await readFile(file, 'utf8')
  const transcript = await history(file, sdk)
  const beforeCatalog = (await catalog({ legacyDir: legacy, projects: [first] }, sdk, agent)).find(
    (item) => item.path === file,
  )
  assert.equal(await renameSession(file, '新的会话标题', sdk), '新的会话标题')
  const after = await readFile(file, 'utf8')
  assert.ok(after.startsWith(before))
  assert.equal(sdk.SessionManager.open(file).getSessionName(), '新的会话标题')
  assert.deepEqual(await history(file, sdk), transcript)
  const renamed = (await catalog({ legacyDir: legacy, projects: [first] }, sdk, agent)).find(
    (item) => item.path === file,
  )
  assert.deepEqual(renamed, { ...beforeCatalog, title: '新的会话标题' })
  const resumed = sdk.SessionManager.open(file)
  resumed.appendMessage({ role: 'user', content: '下一轮对话', timestamp: Date.now() })
  assert.equal(sdk.SessionManager.open(file).getSessionName(), '新的会话标题')
  await assert.rejects(renameSession(`${file}.missing`, '不存在的会话', sdk))
})
