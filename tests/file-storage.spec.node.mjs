import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareFileStorage } from '../runtime/file-storage.mjs'

await mkdir('work', { recursive: true })
const root = await mkdtemp(path.resolve('work', 'file-storage-test-'))
after(() => rm(root, { recursive: true, force: true }))
const sdkRoot = path.resolve('node_modules/@earendil-works/pi-coding-agent/dist/core')
const { SessionManager } = await import(
  pathToFileURL(path.join(sdkRoot, 'session-manager.js')).href
)
const { buildSystemPrompt, normalizeBuildSystemPromptOptions } = await import(
  pathToFileURL(path.join(sdkRoot, 'system-prompt.js')).href
)

test('artifact paths stay outside the project and remain associated with the native session after reload', async () => {
  const project = path.join(root, '项目 source')
  const files = path.join(root, '用户 Files')
  const configuration = path.join(root, 'file-storage.json')
  await mkdir(project)
  await writeFile(configuration, JSON.stringify({ directory: files }))
  const session = SessionManager.create(project, path.join(root, 'sessions'))
  session.appendMessage({ role: 'user', content: '生成报告', timestamp: Date.now() })
  session.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: '准备生成' }],
    stopReason: 'stop',
    timestamp: Date.now(),
  })
  const event = {
    systemPromptOptions: normalizeBuildSystemPromptOptions({
      cwd: project,
      sections: { existing: 'keep' },
    }),
  }
  const ctx = { cwd: project, sessionManager: session }
  const pi = { appendEntry: (type, data) => session.appendCustomEntry(type, data) }
  await prepareFileStorage(event, ctx, pi, configuration)
  const generated = path.join(files, 'Generated', session.getSessionId())
  const prompt = buildSystemPrompt(event.systemPromptOptions)
  assert.ok(prompt.includes(JSON.stringify(generated)))
  assert.equal(event.systemPromptOptions.sections.existing, 'keep')
  assert.equal(event.systemPromptOptions.forceSystemPrompt, undefined)
  await writeFile(path.join(generated, '报告.txt'), 'generated artifact')
  await prepareFileStorage(event, ctx, pi, configuration)
  const entries = SessionManager.open(session.getSessionFile())
    .getEntries()
    .filter((entry) => entry.type === 'custom' && entry.customType === 'hearth-file-storage')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].data.generated, generated)
  assert.equal(session.getCwd(), project)
  const next = path.join(root, 'New Files')
  await writeFile(configuration, JSON.stringify({ directory: next }))
  await prepareFileStorage(event, ctx, pi, configuration)
  assert.ok(
    buildSystemPrompt(event.systemPromptOptions).includes(
      JSON.stringify(path.join(next, 'Generated', session.getSessionId())),
    ),
  )
  assert.equal(await readFile(path.join(generated, '报告.txt'), 'utf8'), 'generated artifact')
  assert.equal(
    session.getEntries().filter((entry) => entry.customType === 'hearth-file-storage').length,
    2,
  )
})

test('invalid settings and session paths cannot create output directories elsewhere', async () => {
  const configuration = path.join(root, 'invalid.json')
  const event = { systemPromptOptions: { sections: {} } }
  const pi = { appendEntry: () => assert.fail('invalid paths must not persist') }
  await writeFile(configuration, JSON.stringify({ directory: '../outside' }))
  await assert.rejects(prepareFileStorage(event, {}, pi, configuration), /文件保存位置无效/)
  await writeFile(configuration, JSON.stringify({ directory: path.join(root, 'valid') }))
  await assert.rejects(
    prepareFileStorage(
      event,
      { sessionManager: { getSessionId: () => '../outside' } },
      pi,
      configuration,
    ),
    /会话/,
  )
  assert.deepEqual(event.systemPromptOptions.sections, {})
})
