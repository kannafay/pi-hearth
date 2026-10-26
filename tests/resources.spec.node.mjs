import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { resourceCatalog } from '../runtime/resources.mjs'
import { resourceKey, readResourcePreferences } from '../runtime/resources.mjs'
import { selectedMcpConfig } from '../runtime/resource-extension.mjs'

const sdkRoot = path.resolve('node_modules/@earendil-works/pi-coding-agent/dist')
const sdk = {
  ...(await import(pathToFileURL(path.join(sdkRoot, 'core/skills.js')))),
  ...(await import(pathToFileURL(path.join(sdkRoot, 'extensions/mcp/config.js')))),
}
await mkdir('work', { recursive: true })
async function fixture() {
  const home = await mkdtemp(path.resolve('work/resource-test-'))
  const agent = path.join(home, '.pi/agent')
  const project = path.join(home, 'project')
  await mkdir(agent, { recursive: true })
  await mkdir(path.join(project, '.pi'), { recursive: true })
  await mkdir(path.join(project, '.git'))
  return {
    home,
    agent,
    project,
    read: () => resourceCatalog({ projectPath: project }, sdk, agent, home),
  }
}
async function skill(directory, name, manual = false) {
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, 'SKILL.md')
  await writeFile(
    file,
    `---\nname: ${name}\ndescription: About ${name}\ndisable-model-invocation: ${manual}\n---\nInstructions are not executed.\n`,
  )
  return file
}

test('skills include Pi, shared agents, project ancestors and extra paths without changing their files', async () => {
  const f = await fixture()
  const global = await skill(path.join(f.agent, 'skills/global'), 'global')
  await skill(path.join(f.home, '.agents/skills/shared'), 'shared', true)
  await skill(path.join(f.project, '.pi/skills/project'), 'project')
  await skill(path.join(f.project, '.agents/skills/ancestor'), 'ancestor')
  await skill(path.join(f.agent, 'extra/custom'), 'custom')
  await writeFile(path.join(f.agent, 'settings.json'), JSON.stringify({ skills: ['./extra'] }))
  const before = await readFile(global, 'utf8')
  const nested = path.join(f.project, 'nested')
  await mkdir(nested)
  const result = await resourceCatalog({ projectPath: nested }, sdk, f.agent, f.home)
  assert.equal(result.skills.length, 4)
  assert.deepEqual(Object.fromEntries(result.skills.map((s) => [s.name, s.scope])), {
    ancestor: 'project',
    global: 'global',
    shared: 'global',
    custom: 'custom',
  })
  assert.equal(result.skills.find((s) => s.name === 'shared').manualOnly, true)
  assert.ok(result.skills.every((s) => s.status === 'unloaded'))
  assert.ok(result.skills.every((s) => s.enabled === true))
  assert.equal(await readFile(global, 'utf8'), before)
  assert.deepEqual((await f.read()).skills.map((s) => s.name).sort(), [
    'ancestor',
    'custom',
    'global',
    'project',
    'shared',
  ])
  assert.deepEqual(result.warnings, [])
})

test('MCP applies project overrides, keeps disabled status and never starts commands or returns credentials', async () => {
  const f = await fixture()
  const marker = path.join(f.home, 'executed')
  const config = path.join(f.agent, 'mcp.json')
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        local: {
          command: process.execPath,
          args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`],
          env: { TOKEN: 'secret-sentinel' },
        },
        docs: {
          url: 'https://example.invalid/mcp?token=secret-sentinel',
          headers: { Authorization: 'Bearer secret-sentinel' },
        },
      },
    }),
  )
  const projectConfig = path.join(f.project, '.pi/mcp.json')
  await writeFile(
    projectConfig,
    JSON.stringify({
      mcpServers: { local: { enabled: false }, project: { command: 'never-run' } },
    }),
  )
  const before = await readFile(config, 'utf8')
  const result = await f.read()
  assert.deepEqual(
    result.mcp.map((s) => [s.name, s.scope, s.status]),
    [
      ['local', 'project', 'disabled'],
      ['docs', 'global', 'unloaded'],
      ['project', 'project', 'unloaded'],
    ],
  )
  assert.equal(result.mcp[0].source, projectConfig)
  assert.deepEqual(
    result.mcp.map((s) => s.enabled),
    [false, true, true],
  )
  assert.equal(JSON.stringify(result).includes('secret-sentinel'), false)
  await assert.rejects(access(marker))
  assert.equal(await readFile(config, 'utf8'), before)
  const globalOnly = await resourceCatalog({}, sdk, f.agent, f.home)
  assert.deepEqual(
    globalOnly.mcp.map((s) => [s.name, s.status]),
    [
      ['local', 'unloaded'],
      ['docs', 'unloaded'],
    ],
  )
})

test('invalid MCP data is sanitized while skills remain available', async () => {
  const f = await fixture()
  await skill(path.join(f.agent, 'skills/usable'), 'usable')
  await writeFile(path.join(f.agent, 'mcp.json'), '{"secret-sentinel": malformed}')
  const result = await f.read()
  assert.equal(result.skills[0].name, 'usable')
  assert.deepEqual(result.mcp, [])
  assert.match(result.warnings.join(''), /MCP 配置问题/)
  assert.equal(JSON.stringify(result).includes('secret-sentinel'), false)
})

test('MCP details expose connection structure without credentials or private URL data', async () => {
  const f = await fixture()
  const source = path.join(f.agent, 'mcp.json')
  const document = JSON.stringify({
    mcpServers: {
      local: {
        command: 'npx',
        args: [
          '-y',
          '@example/mcp',
          '--api-key=argument-secret',
          '--password',
          'password-secret',
          '--endpoint=https://user:uri-secret@example.invalid/private-path?token=query-secret',
        ],
        env: { TOKEN: 'environment-secret' },
      },
      remote: {
        url: 'https://user:uri-secret@example.invalid/private-path?token=query-secret',
        headers: { Authorization: 'Bearer header-secret' },
      },
    },
  })
  await writeFile(source, document)
  const catalog = await f.read()
  const local = JSON.parse(catalog.mcp[0].configuration)
  assert.equal(local.command, 'npx')
  assert.deepEqual(local.args.slice(0, 2), ['-y', '@example/mcp'])
  assert.equal(local.env.TOKEN, '[已隐藏]')
  assert.equal(JSON.parse(catalog.mcp[1].configuration).url, 'https://example.invalid/…')
  for (const secret of [
    'argument-secret',
    'password-secret',
    'environment-secret',
    'uri-secret',
    'private-path',
    'query-secret',
    'header-secret',
  ])
    assert.equal(JSON.stringify(catalog).includes(secret), false)
  assert.equal(await readFile(source, 'utf8'), document)
})

test('empty directories are quiet and unsupported skill packages or filters are explicit', async () => {
  const f = await fixture()
  assert.deepEqual(await f.read(), { skills: [], mcp: [], warnings: [] })
  await writeFile(
    path.join(f.agent, 'settings.json'),
    JSON.stringify({ packages: ['npm:not-installed'], skills: ['!disabled/**'] }),
  )
  const result = await f.read()
  assert.equal(result.warnings.length, 2)
  assert.match(result.warnings.join(''), /资源包/)
  assert.match(result.warnings.join(''), /筛选规则/)
})

test('the native helper resources action resolves SDK modules and returns a JSON catalog', async () => {
  const f = await fixture()
  await skill(path.join(f.agent, 'skills/cli'), 'cli')
  const child = spawnSync(
    process.execPath,
    ['runtime/session-catalog.mjs', path.join(sdkRoot, 'core/session-manager.js')],
    {
      input: JSON.stringify({ action: 'resources', projectPath: f.project }),
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, PI_CODING_AGENT_DIR: f.agent, USERPROFILE: f.home, HOME: f.home },
    },
  )
  assert.equal(child.status, 0, child.stderr)
  assert.equal(JSON.parse(child.stdout).skills[0].name, 'cli')
})

test('resource enablement inherits Pi defaults with independent desktop overrides', async () => {
  const f = await fixture()
  const file = path.join(f.home, 'resources.json')
  assert.deepEqual(await readResourcePreferences(file), {})
  const source = path.join(f.agent, 'mcp.json')
  const loaded = {
    servers: [
      { name: 'one', source, config: { command: 'never-run', enabled: false } },
      { name: 'two', source, config: { command: 'never-run' } },
    ],
    errors: [],
  }
  assert.deepEqual(
    selectedMcpConfig(loaded, {}).servers.map((s) => s.name),
    ['two'],
  )
  const preferences = {
    [resourceKey('mcp', source, 'one')]: true,
    [resourceKey('mcp', source, 'two')]: false,
  }
  await writeFile(file, JSON.stringify(preferences))
  const selected = selectedMcpConfig(loaded, await readResourcePreferences(file))
  assert.equal(selected.servers.length, 1)
  assert.equal(selected.servers[0].name, 'one')
  assert.equal(selected.servers[0].config.enabled, true)
  assert.equal(selected.servers[0].config.exposure, 'direct')
  assert.equal(loaded.servers[0].config.enabled, false)
  assert.equal(loaded.servers[1].config.enabled, undefined)
  assert.deepEqual(
    selectedMcpConfig(loaded, { [resourceKey('mcp', source, 'one')]: true }).servers.map(
      (s) => s.name,
    ),
    ['one', 'two'],
  )
  await writeFile(file, 'bad json')
  await assert.rejects(readResourcePreferences(file), /无法读取资源启停设置/)
})

test('model refresh uses the pinned offline registry and returns no credentials', async () => {
  const f = await fixture()
  const file = path.join(f.agent, 'models.json')
  const models = {
    providers: {
      'catalog-test': {
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: 'secret-sentinel',
        models: [
          { id: 'first', name: 'First', input: ['text'], contextWindow: 128000, maxTokens: 4096 },
        ],
      },
    },
  }
  await writeFile(file, JSON.stringify(models))
  await writeFile(path.join(f.agent, 'auth.json'), '{}')
  const read = () =>
    spawnSync(
      process.execPath,
      ['runtime/session-catalog.mjs', path.join(sdkRoot, 'core/session-manager.js')],
      {
        input: JSON.stringify({ action: 'models', directory: f.agent }),
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: f.agent,
          USERPROFILE: f.home,
          HOME: f.home,
          PI_OFFLINE: '1',
        },
      },
    )
  const first = read()
  assert.equal(first.status, 0, first.stderr)
  assert.ok(
    JSON.parse(first.stdout).some(
      (item) => item.provider === 'catalog-test' && item.id === 'first',
    ),
  )
  assert.equal(first.stdout.includes('secret-sentinel'), false)
  models.providers['catalog-test'].models.push({
    ...models.providers['catalog-test'].models[0],
    id: 'second',
    name: 'Second',
  })
  await writeFile(file, JSON.stringify(models))
  const second = read()
  assert.equal(second.status, 0, second.stderr)
  assert.ok(
    JSON.parse(second.stdout).some(
      (item) => item.provider === 'catalog-test' && item.id === 'second',
    ),
  )
})
