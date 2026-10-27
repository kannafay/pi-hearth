import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { evaluateToolRisk } from '../runtime/permissions.mjs'
import { guardTool } from '../runtime/tool-guard.mjs'

test(
  'Gemini risk assessment disables default thinking, preserves JSON, and skips manual approval for an allow verdict',
  { timeout: 15_000 },
  async () => {
    await mkdir('work', { recursive: true })
    const root = await mkdtemp(path.resolve('work', 'permission-google-'))
    const requests = []
    const server = createServer(async (request, response) => {
      let text = ''
      for await (const chunk of request) text += chunk
      const body = JSON.parse(text)
      requests.push(body)
      const configured =
        body.generationConfig?.thinkingConfig?.thinkingBudget === 0 &&
        body.generationConfig?.maxOutputTokens >= 1024
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [configured ? { text: '```json\n{"decision":"allow"}\n```' } : { text: 'Checking risk', thought: true }] }, finishReason: configured ? 'STOP' : 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 } })}\n\n`,
      )
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const modelsPath = path.join(root, 'models.json')
    await writeFile(
      modelsPath,
      JSON.stringify({
        providers: {
          'permission-google-test': {
            api: 'google-generative-ai',
            baseUrl: `http://127.0.0.1:${server.address().port}/v1beta`,
            apiKey: 'isolated-google-test-key',
            models: [
              {
                id: 'gemini-2.5-flash',
                name: 'Risk model',
                reasoning: true,
                input: ['text'],
                contextWindow: 1048576,
                maxTokens: 65536,
              },
            ],
          },
        },
      }),
    )
    try {
      const runtime = await ModelRuntime.create({
        modelsPath,
        authPath: path.join(root, 'auth.json'),
        modelsStorePath: path.join(root, 'models-store.json'),
      })
      const registry = new ModelRegistry(runtime)
      const model = registry.find('permission-google-test', 'gemini-2.5-flash')
      assert(model)
      const legacy = await registry.complete(
        model,
        { messages: [{ role: 'user', content: 'Assess this tool call', timestamp: Date.now() }] },
        { maxTokens: 128, signal: AbortSignal.timeout(5000) },
      )
      assert.equal(legacy.stopReason, 'length')
      let approvals = 0
      const ctx = {
        cwd: root,
        model,
        modelRegistry: registry,
        hasUI: true,
        sessionManager: {
          getEntries: () => [
            { type: 'custom', customType: 'hearth-permission', data: { mode: 'auto' } },
          ],
          getBranch: () => [
            { type: 'message', message: { role: 'user', content: '检查项目状态' } },
          ],
        },
        ui: {
          confirm: async () => {
            approvals++
            return false
          },
        },
      }
      const result = await guardTool(
        {
          toolName: 'powershell',
          toolCallId: 'routine-command',
          input: { command: 'git status --short' },
        },
        ctx,
        evaluateToolRisk,
      )
      assert.equal(result, undefined)
      assert.equal(approvals, 0)
      assert.equal(requests.length, 2)
      assert.equal(requests[1].generationConfig.thinkingConfig.thinkingBudget, 0)
      assert.equal(requests[1].generationConfig.maxOutputTokens, 1024)
      assert.equal(requests[1].generationConfig.temperature, undefined)
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  },
)

test(
  'the real Pi extension assesses auto calls with the current model and enforces all three modes',
  { timeout: 20_000 },
  async () => {
    await mkdir('work', { recursive: true })
    const root = await mkdtemp(path.resolve('work', 'permission-runtime-'))
    const project = path.join(root, 'project')
    const config = path.join(root, 'config')
    await mkdir(project)
    await mkdir(config)
    const assessments = []
    const models = []
    let calls = 0
    const server = createServer(async (request, response) => {
      let text = ''
      for await (const chunk of request) text += chunk
      const body = JSON.parse(text)
      assert.equal(request.headers.authorization, 'Bearer isolated-test-key')
      const contentText = (message) =>
        typeof message.content === 'string'
          ? message.content
          : message.content.map((block) => block.text ?? '').join('\n')
      models.push(body.model)
      const reviewing = body.messages.some(
        (message) =>
          message.role === 'system' && contentText(message).includes('独立的工具调用风险审核器'),
      )
      let delta
      let finish = 'stop'
      if (reviewing) {
        const review = JSON.parse(contentText(body.messages.at(-1)))
        assessments.push(review)
        assert(body.max_tokens >= 1024 || body.max_completion_tokens >= 1024)
        delta = {
          content: JSON.stringify({
            decision: review.args.content === 'uncertain' ? 'ask' : 'allow',
          }),
        }
      } else if (body.messages.at(-1).role === 'tool') {
        delta = { content: 'done' }
      } else {
        const uncertain = contentText(body.messages.at(-1)).includes('uncertain')
        delta = {
          tool_calls: [
            {
              index: 0,
              id: `write-${++calls}`,
              type: 'function',
              function: {
                name: 'write',
                arguments: JSON.stringify({
                  path: 'result.txt',
                  content: uncertain ? 'uncertain' : 'routine',
                }),
              },
            },
          ],
        }
        finish = 'tool_calls'
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        [
          {
            id: 'mock',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }],
          },
          {
            id: 'mock',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: finish }],
          },
        ]
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join('') + 'data: [DONE]\n\n',
      )
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const endpoint = `http://127.0.0.1:${server.address().port}/v1`
    await writeFile(
      path.join(config, 'models.json'),
      JSON.stringify({
        providers: {
          'permission-test': {
            api: 'openai-completions',
            baseUrl: endpoint,
            apiKey: 'isolated-test-key',
            models: [
              {
                id: 'risk-model',
                name: 'Risk model',
                reasoning: false,
                input: ['text'],
                contextWindow: 128000,
                maxTokens: 4096,
              },
            ],
          },
        },
      }),
    )
    const agentEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
    const child = spawn(
      process.execPath,
      [
        path.join(path.dirname(agentEntry), 'bundle/cli.js'),
        '--mode',
        'rpc',
        '--provider',
        'permission-test',
        '--model',
        'risk-model',
        '--tools',
        'read,write',
        '--no-extensions',
        '--no-mcp',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--no-approve',
        '--offline',
        '--extension',
        path.resolve('runtime/tool-guard.mjs'),
        '--session-dir',
        path.join(root, 'sessions'),
      ],
      {
        cwd: project,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: config,
          PI_TELEMETRY: '0',
          HEARTH_MESSAGE_ACTION_TOKEN: 'test-token',
          HEARTH_FILE_STORAGE_CONFIG: '',
        },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    const pending = new Map()
    const records = []
    const events = new EventEmitter()
    let sequence = 0
    let approvals = 0
    let errors = ''
    child.stderr.on('data', (data) => {
      errors += data
    })
    child.on('exit', () => {
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error(errors || 'Pi exited'))
      }
      pending.clear()
    })
    createInterface({ input: child.stdout }).on('line', (text) => {
      const event = JSON.parse(text)
      records.push(event)
      if (event.type === 'response' && pending.has(event.id)) {
        const waiter = pending.get(event.id)
        pending.delete(event.id)
        clearTimeout(waiter.timer)
        if (event.success) waiter.resolve(event.data)
        else waiter.reject(new Error(event.error))
      } else if (event.type === 'extension_ui_request' && event.method === 'confirm') {
        approvals++
        child.stdin.write(
          `${JSON.stringify({ type: 'extension_ui_response', id: event.id, confirmed: false })}\n`,
        )
      } else if (event.type === 'agent_settled') events.emit('settled', event)
    })
    const request = (type, data = {}) =>
      new Promise((resolve, reject) => {
        const id = String(++sequence)
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Pi ${type} timed out: ${errors}`))
        }, 8_000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(`${JSON.stringify({ id, type, ...data })}\n`)
      })
    const prompt = async (message) => {
      const settled = once(events, 'settled', { signal: AbortSignal.timeout(8_000) })
      await request('prompt', { message })
      await settled
    }
    const mode = async (value) =>
      request('prompt', { message: `/hearth-permission test-token ${value}` })
    try {
      const commands = await request('get_commands')
      assert(commands.commands.some((command) => command.name === 'hearth-guard-ready'))
      await mode('auto')
      await prompt('routine request')
      assert.equal(
        await readFile(path.join(project, 'result.txt'), 'utf8').catch(() => null),
        'routine',
        JSON.stringify({
          assessments,
          models,
          records: records.filter((record) => record.type === 'tool_execution_end'),
        }),
      )
      assert.equal(approvals, 0)
      assert.equal(assessments.length, 1)
      assert.equal(assessments[0].task, 'routine request')
      assert.equal(assessments[0].tool, 'write')
      await prompt('uncertain request')
      assert.equal(approvals, 1)
      assert.equal(assessments.length, 2)
      assert.equal(await readFile(path.join(project, 'result.txt'), 'utf8'), 'routine')
      await mode('full')
      await prompt('uncertain request')
      assert.equal(approvals, 1)
      assert.equal(assessments.length, 2)
      assert.equal(await readFile(path.join(project, 'result.txt'), 'utf8'), 'uncertain')
      await mode('ask')
      await prompt('routine request')
      assert.equal(approvals, 2)
      assert.equal(assessments.length, 2)
      assert.equal(await readFile(path.join(project, 'result.txt'), 'utf8'), 'uncertain')
      assert(models.every((model) => model === 'risk-model'))
      const entries = await request('get_entries')
      assert.deepEqual(
        entries.entries
          .filter((entry) => entry.customType === 'hearth-permission')
          .map((entry) => entry.data.mode),
        ['auto', 'full', 'ask'],
      )
    } finally {
      if (child.exitCode === null) {
        const closed = once(child, 'exit')
        child.kill()
        await closed
      }
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  },
)
