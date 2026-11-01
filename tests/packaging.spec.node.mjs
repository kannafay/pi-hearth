import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  assertPortable,
  checkTarget,
  ownedPath,
  sha256,
  verifyArchive,
} from '../scripts/prepare-runtime.mjs'
import { cleanEnvironment } from '../scripts/verify-installed-runtime.mjs'

test('installed runtime checks have no developer executable search path or model credentials', () => {
  const environment = cleanEnvironment({
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\developer-node',
    OPENAI_API_KEY: 'must-not-inherit',
    npm_execpath: 'dev-pnpm',
  })
  assert(!environment.PATH.includes('developer-node'))
  assert.equal(environment.OPENAI_API_KEY, undefined)
  assert.equal(environment.npm_execpath, undefined)
  assert(environment.NODE_OPTIONS.includes('must-not-use'))
})

test('runtime downloads reject modified or incomplete archives', () => {
  const bytes = Buffer.from('official-release-fixture')
  verifyArchive(bytes, sha256(bytes))
  assert.throws(() => verifyArchive(Buffer.from('changed'), sha256(bytes)), /SHA-256/)
  assert.throws(() => verifyArchive(bytes.subarray(1), sha256(bytes)), /SHA-256/)
})

test('Windows staging refuses a mismatched host or cross-compilation target', () => {
  const target = 'x86_64-pc-windows-msvc'
  checkTarget('win32', 'x64', target, target)
  checkTarget('win32', 'x64', undefined, target)
  for (const [platform, arch, requested] of [
    ['linux', 'x64', target],
    ['win32', 'arm64', target],
    ['win32', 'x64', 'aarch64-pc-windows-msvc'],
  ])
    assert.throws(() => checkTarget(platform, arch, requested, target), /Windows x64/)
})

test('cleanup paths cannot escape their owned staging directory', () => {
  const root = path.resolve('work/runtime-fixture')
  assert.equal(ownedPath(root, path.join(root, 'node')), path.join(root, 'node'))
  for (const target of [
    root,
    path.dirname(root),
    root + '-neighbor',
    path.join(root, '..', 'private'),
  ])
    assert.throws(() => ownedPath(root, target), /超出预期/)
})

test('portable runtime validation rejects directory links back to a development installation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hearth-packaging-test-'))
  try {
    await mkdir(path.join(root, 'stage'))
    await mkdir(path.join(root, 'development'))
    await writeFile(path.join(root, 'stage', 'package.json'), '{}')
    await assertPortable(path.join(root, 'stage'))
    await symlink(
      path.join(root, 'development'),
      path.join(root, 'stage', 'linked-dependency'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await assert.rejects(assertPortable(path.join(root, 'stage')), /包含链接/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('development and distribution lock the same Pi version', async () => {
  const project = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const runtime = JSON.parse(
    await readFile(new URL('../runtime/package.json', import.meta.url), 'utf8'),
  )
  assert.equal(
    runtime.dependencies['@earendil-works/pi-coding-agent'],
    project.devDependencies['@earendil-works/pi-coding-agent'],
  )
  assert.match(runtime.dependencies['@earendil-works/pi-coding-agent'], /^\d+\.\d+\.\d+$/)
})

test('the distribution carries the Pi upstream copyright and permission notice', async () => {
  const license = await readFile(new URL('../runtime/licenses/pi-MIT.txt', import.meta.url), 'utf8')
  assert(license.includes('Copyright (c) 2025 Mario Zechner'))
  assert(license.includes('The above copyright notice and this permission notice'))
})
