import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { resourceCatalog } from '../runtime/resources.mjs'

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
