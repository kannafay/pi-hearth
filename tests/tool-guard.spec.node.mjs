import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises'
import path from 'node:path'
import { guardTool, isProjectRead, resolveToolPath, rewindMessage } from '../runtime/tool-guard.mjs'
import { changePermission, evaluateToolRisk, sessionPermission } from '../runtime/permissions.mjs'

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

function permissionContext(mode, confirm = async () => false) {
  return {
    cwd: project,
    hasUI: true,
    ui: { confirm },
    sessionManager: {
      getEntries: () => [{ type: 'custom', customType: 'hearth-permission', data: { mode } }],
      getBranch: () => [],
    },
  }
}

test('permissions default to ask and the latest session entry survives a branch rewind', () => {
  assert.equal(sessionPermission({}), 'ask')
  const ctx = permissionContext('full')
  assert.equal(sessionPermission(ctx), 'full')
  ctx.sessionManager.getEntries = () => [
    { type: 'custom', customType: 'hearth-permission', data: { mode: 'full' } },
    { type: 'custom', customType: 'hearth-permission', data: { mode: 'invalid' } },
  ]
  assert.equal(sessionPermission(ctx), 'ask')
})

test('permission changes require the runtime token and an idle conversation', () => {
  const ctx = { ...permissionContext('ask'), isIdle: () => true }
  const entries = []
  ctx.sessionManager.getEntries = () => entries
  const pi = {
    appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }),
  }
  for (const args of ['wrong full', 'token invalid', 'token full extra', 'token'])
    assert.throws(() => changePermission(pi, args, ctx, 'token'))
  assert.throws(() => changePermission(pi, 'token full', { ...ctx, isIdle: () => false }, 'token'))
  assert.equal(entries.length, 0)
  changePermission(pi, 'token ask', ctx, 'token')
  changePermission(pi, 'token auto', ctx, 'token')
  changePermission(pi, 'token auto', ctx, 'token')
  assert.equal(entries.length, 2)
  assert.equal(sessionPermission(ctx), 'auto')
})

test('full access bypasses approval only for enabled tools and still honors stop', async () => {
  let confirmations = 0
  const ctx = permissionContext('full', async () => {
    confirmations++
    return false
  })
  for (const toolName of ['read', 'write', 'edit', 'bash', 'powershell']) {
    const event = { toolName, input: { path: '../outside/secret.txt', command: 'example' } }
    assert.equal(await guardTool(event, ctx), undefined)
    assert.equal((await guardTool(event, { ...ctx, signal: AbortSignal.abort() })).block, true)
  }
  assert.equal((await guardTool({ toolName: 'unexpected', input: {} }, ctx)).block, true)
  assert.equal(confirmations, 0)
})

test('auto permits model-approved project edits and new files; outside and symlink targets always ask', async () => {
  let assessments = 0
  let confirmations = 0
  const ctx = permissionContext('auto', async () => {
    confirmations++
    return false
  })
  const assess = async () => {
    assessments++
    return true
  }
  for (const [toolName, input] of [
    ['edit', { path: 'a.txt' }],
    ['write', { path: 'new/sub/file.txt' }],
    ['powershell', { command: 'pnpm test' }],
  ])
    assert.equal(await guardTool({ toolName, input }, ctx, assess), undefined)
  assert.equal(assessments, 3)
  const linked = path.join(project, 'auto-link')
  await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir')
  for (const location of ['../outside/new.txt', 'auto-link/new/sub/file.txt']) {
    assert.equal(
      (await guardTool({ toolName: 'write', input: { path: location } }, ctx, assess)).block,
      true,
    )
  }
  assert.equal(assessments, 3)
  assert.equal(confirmations, 2)
})

test('auto falls back to confirmation for dangerous, unavailable or failed assessments', async () => {
  for (const assess of [
    undefined,
    async () => false,
    async () => {
      throw new Error('offline')
    },
  ]) {
    let confirmations = 0
    const ctx = permissionContext('auto', async () => {
      confirmations++
      return false
    })
    assert.equal(
      (await guardTool({ toolName: 'bash', input: { command: 'delete data' } }, ctx, assess)).block,
      true,
    )
    assert.equal(confirmations, 1)
    ctx.ui.confirm = async () => true
    assert.equal(
      await guardTool({ toolName: 'bash', input: { command: 'delete data' } }, ctx, assess),
      undefined,
    )
  }
  const controller = new AbortController()
  let confirmations = 0
  const ctx = {
    ...permissionContext('auto', async () => {
      confirmations++
      return true
    }),
    signal: controller.signal,
  }
  assert.equal(
    (
      await guardTool({ toolName: 'bash', input: { command: 'test' } }, ctx, async () => {
        controller.abort()
        return true
      })
    ).block,
    true,
  )
  assert.equal(confirmations, 0)
})

test('risk assessment uses the current model and task and accepts only a complete JSON allow verdict', async () => {
  const model = { provider: 'test', id: 'current' }
  const ctx = {
    ...permissionContext('auto'),
    model,
    modelRegistry: {},
  }
  ctx.sessionManager.getBranch = () => [
    {
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: '修复项目并运行测试' }] },
    },
  ]
  const event = { toolName: 'bash', input: { command: 'pnpm test' } }
  let request
  const complete = async (...args) => {
    request = args
    return { stopReason: 'stop', content: [{ type: 'text', text: '{"decision":"allow"}' }] }
  }
  ctx.modelRegistry.complete = complete
  assert.equal(await evaluateToolRisk(event, ctx), true)
  assert.equal(request[0], model)
  assert.equal(request[2].signal.aborted, false)
  assert.deepEqual(JSON.parse(request[1].messages[0].content), {
    task: '修复项目并运行测试',
    cwd: project,
    tool: 'bash',
    args: event.input,
  })
  for (const [stopReason, text] of [
    ['length', '{"decision":"allow"}'],
    ['stop', 'allow'],
    ['stop', '{"decision":"ask"}'],
    ['error', '{"decision":"allow"}'],
  ]) {
    assert.equal(
      await evaluateToolRisk(event, ctx, async () => ({
        stopReason,
        content: [{ type: 'text', text }],
      })),
      false,
    )
  }
  assert.equal(await evaluateToolRisk(event, { ...ctx, model: null }, complete), false)
  assert.equal(
    await evaluateToolRisk({ ...event, input: { command: 'x'.repeat(12_001) } }, ctx, complete),
    false,
  )
  const controller = new AbortController()
  assert.equal(
    await evaluateToolRisk(event, { ...ctx, signal: controller.signal }, async () => {
      controller.abort()
      return { stopReason: 'stop', content: [{ type: 'text', text: '{"decision":"allow"}' }] }
    }),
    false,
  )
})
