import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises'
import path from 'node:path'
import { guardTool, isProjectRead, resolveToolPath, rewindMessage } from '../runtime/tool-guard.mjs'

await mkdir('work', { recursive: true })
const root = await mkdtemp(path.resolve('work', 'guard-test-'))
const project = path.join(root, '中文 project')
const outside = path.join(root, 'outside')
await mkdir(project)
await mkdir(outside)
await writeFile(path.join(project, 'a.txt'), 'ok')
await writeFile(path.join(outside, 'secret.txt'), 'outside')

test('message rewind requires its runtime token and a user message on the active branch', async () => {
  const entries = [{ type: 'message', id: 'user-1', message: { role: 'user' } }]
  let target
  let markers = 0
  const pi = {
    appendEntry: () => {
      markers++
    },
  }
  const ctx = {
    isIdle: () => true,
    sessionManager: { getBranch: () => entries, getLeafId: () => 'user-1' },
    navigateTree: async (id, options) => {
      target = [id, options]
      return { cancelled: false }
    },
  }
  await assert.rejects(() => rewindMessage(pi, 'wrong user-1', ctx, 'token'))
  await assert.rejects(() => rewindMessage(pi, 'token outside', ctx, 'token'))
  await assert.rejects(() =>
    rewindMessage(pi, 'token user-1', { ...ctx, isIdle: () => false }, 'token'),
  )
  assert.equal(markers, 0)
  await rewindMessage(pi, 'token user-1', ctx, 'token')
  assert.equal(markers, 1)
  assert.deepEqual(target, ['user-1', { summarize: false }])
})

test('only real project reads bypass confirmation', async () => {
  assert.equal(await isProjectRead(path.join(project, 'a.txt'), project), true)
  assert.equal(await isProjectRead(path.join(outside, 'secret.txt'), project), false)
  assert.equal(await isProjectRead(path.join(project, 'missing.txt'), project), false)
  await symlink(
    outside,
    path.join(project, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  assert.equal(await isProjectRead(path.join(project, 'link', 'secret.txt'), project), false)
  let confirmations = 0
  const event = { toolCallId: '1', toolName: 'read', input: { path: '@a.txt' } }
  assert.equal(
    await guardTool(event, {
      cwd: project,
      hasUI: true,
      ui: {
        confirm: () => {
          confirmations++
        },
      },
    }),
    undefined,
  )
  assert.equal(confirmations, 0)
  assert.equal(event.input.path, path.join(project, 'a.txt'))
})

test('writes, edits, commands and outside reads require a successful confirmation', async () => {
  for (const toolName of ['write', 'edit', 'powershell', 'bash', 'read']) {
    let request
    const event = {
      toolCallId: toolName,
      toolName,
      input: { path: '../outside/secret.txt', command: 'example' },
    }
    const ctx = {
      cwd: project,
      hasUI: true,
      ui: {
        confirm: async (_title, message) => {
          request = JSON.parse(message)
          return true
        },
      },
    }
    assert.equal(await guardTool(event, ctx), undefined)
    assert.equal(request.toolCallId, toolName)
    assert.equal(request.args.path, path.join(outside, 'secret.txt'))
    for (const result of [false, undefined]) {
      ctx.ui.confirm = async () => result
      assert.equal((await guardTool(event, ctx)).block, true)
    }
    ctx.ui.confirm = async () => {
      throw new Error('closed')
    }
    assert.equal((await guardTool(event, ctx)).block, true)
    assert.equal((await guardTool(event, { ...ctx, hasUI: false })).block, true)
    assert.equal((await guardTool(event, { ...ctx, signal: AbortSignal.abort() })).block, true)
  }
})

test('path spellings are normalized and unsupported tools fail closed', async () => {
  assert.equal(
    resolveToolPath('@folder\u00a0name/a.txt', project),
    path.join(project, 'folder name', 'a.txt'),
  )
  assert.equal(
    (await guardTool({ toolName: 'unexpected', input: {} }, { cwd: project })).block,
    true,
  )
})
