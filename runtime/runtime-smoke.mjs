import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const pi = path.join(directory, 'node_modules/@earendil-works/pi-coding-agent')
const scratch = await mkdtemp(path.join(tmpdir(), 'pi-hearth-runtime-中文 空格-'))
const environment = {
  ...process.env,
  PI_CODING_AGENT_DIR: path.join(scratch, 'agent'),
  PI_OFFLINE: '1',
  PI_TELEMETRY: '0',
}
delete environment.NODE_PATH
delete environment.NODE_OPTIONS

async function helper(script, args, input) {
  const child = spawn(process.execPath, [path.join(directory, script), ...args], {
    env: environment,
    cwd: scratch,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  })
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (data) => {
    stdout += data
  })
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-8192)
  })
  child.stdin.end(JSON.stringify(input))
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script}: ${stderr || code}`)),
    )
  })
  return JSON.parse(stdout)
}

async function rpc() {
  const child = spawn(
    process.execPath,
    [
      path.join(pi, 'dist/bundle/cli.js'),
      '--mode',
      'rpc',
      '--offline',
      '--no-extensions',
      '--no-mcp',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '--no-approve',
      '--tools',
      'read,write,edit,powershell',
      '--extension',
      path.join(directory, 'tool-guard.mjs'),
      '--extension',
      path.join(directory, 'resource-extension.mjs'),
      '--session-dir',
      path.join(scratch, 'sessions'),
    ],
    {
      env: { ...environment, HEARTH_MESSAGE_ACTION_TOKEN: 'installation-smoke' },
      cwd: scratch,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  const lines = createInterface({ input: child.stdout })
  const pending = new Map()
  let stderr = ''
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-8192)
  })
  const fail = (error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  child.once('error', fail)
  child.once('exit', (code) => fail(new Error(`Pi RPC exited (${code}): ${stderr}`)))
  lines.on('line', (line) => {
    let value
    try {
      value = JSON.parse(line)
    } catch {
      return
    }
    const request = pending.get(value.id)
    if (request && value.type === 'response') {
      pending.delete(value.id)
      if (value.success) request.resolve(value)
      else request.reject(new Error(value.error || stderr))
    }
  })
  try {
    for (const type of ['get_state', 'get_available_models', 'get_commands']) {
      let timer
      const response = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Pi RPC ${type} timed out: ${stderr}`)), 30_000)
        pending.set(type, { resolve, reject })
        child.stdin.write(JSON.stringify({ id: type, type }) + '\n')
      }).finally(() => clearTimeout(timer))
      if (type === 'get_commands') {
        assert(response.data.commands.some((command) => command.name === 'hearth-guard-ready'))
        assert(response.data.commands.some((command) => command.name === 'hearth-message-rewind'))
      }
    }
  } finally {
    lines.close()
    child.stdin.end()
    child.kill()
    if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve))
  }
}

try {
  assert((await readFile(path.join(directory, '../node/LICENSE'), 'utf8')).length > 100)
  assert(
    (await readFile(path.join(directory, '../licenses/pi-MIT.txt'), 'utf8')).includes(
      'Mario Zechner',
    ),
  )
  await mkdir(environment.PI_CODING_AGENT_DIR)
  await mkdir(path.join(scratch, 'sessions'))
  await writeFile(path.join(environment.PI_CODING_AGENT_DIR, 'models.json'), '{"providers":{}}')
  const sdk = path.join(pi, 'dist/core/session-manager.js')
  const entries = await helper('session-catalog.mjs', [sdk], {
    action: 'list',
    legacyDir: path.join(scratch, 'sessions'),
    projects: [scratch],
  })
  assert(Array.isArray(entries))
  const resources = await helper('session-catalog.mjs', [sdk], {
    action: 'resources',
    projectPath: scratch,
  })
  assert(Array.isArray(resources.skills) && Array.isArray(resources.mcp))
  const models = await helper('session-catalog.mjs', [sdk], {
    action: 'models',
    directory: environment.PI_CODING_AGENT_DIR,
  })
  assert(Array.isArray(models))
  const server = createServer((_, response) => {
    response.writeHead(200)
    response.end('ok')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const network = await helper(
      'network-test.mjs',
      [path.join(pi, 'dist/core/http-dispatcher.js')],
      { target: `http://127.0.0.1:${server.address().port}` },
    )
    assert.equal(network.success, true)
    assert.equal(network.status, 200)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  await rpc()
  const metadata = JSON.parse(await readFile(path.join(pi, 'package.json'), 'utf8'))
  console.log(
    JSON.stringify({
      success: true,
      nodeExecutable: process.execPath,
      piEntrypoint: path.join(pi, 'dist/bundle/cli.js'),
      piVersion: metadata.version,
      checks: [
        'licenses',
        'sessions',
        'resources',
        'models',
        'network',
        'rpc',
        'approval-extension',
      ],
    }),
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}
