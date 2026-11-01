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

test('Windows setup uses Chinese without a language dialog or administrator installation mode', async () => {
  const config = JSON.parse(
    await readFile(new URL('../src-tauri/tauri.windows.conf.json', import.meta.url), 'utf8'),
  )
  const nsis = config.bundle.windows.nsis
  assert.equal(nsis.installMode, 'currentUser')
  assert.deepEqual(nsis.languages, ['SimpChinese'])
  assert.equal(nsis.displayLanguageSelector, false)
  for (const file of [nsis.template, nsis.customLanguageFiles.SimpChinese])
    assert((await readFile(new URL(`../src-tauri/${file}`, import.meta.url))).length > 0)
})

test('installer branding uses valid native bitmaps at NSIS header and sidebar dimensions', async () => {
  const config = JSON.parse(
    await readFile(new URL('../src-tauri/tauri.windows.conf.json', import.meta.url), 'utf8'),
  )
  const nsis = config.bundle.windows.nsis
  for (const [file, width, height] of [
    [nsis.headerImage, 150, 57],
    [nsis.sidebarImage, 164, 314],
  ]) {
    const bytes = await readFile(new URL(`../src-tauri/${file}`, import.meta.url))
    assert.equal(bytes.toString('ascii', 0, 2), 'BM')
    assert.equal(bytes.readUInt32LE(2), bytes.length)
    assert.equal(bytes.readInt32LE(18), width)
    assert.equal(bytes.readInt32LE(22), height)
    assert.equal(bytes.readUInt16LE(28), 24)
    assert.equal(bytes.readUInt32LE(30), 0, 'native installer images must be uncompressed')
    assert.equal(bytes.length - bytes.readUInt32LE(10), Math.ceil((width * 3) / 4) * 4 * height)
  }
  for (const file of [nsis.installerIcon, nsis.uninstallerIcon]) {
    const icon = await readFile(new URL(`../src-tauri/${file}`, import.meta.url))
    assert.equal(icon.readUInt32LE(0), 0x10000, 'installer icon must be an ICO resource')
  }
})

test('all Tauri installer messages have Chinese translations without unresolved template variables', async () => {
  const template = await readFile(
    new URL('../src-tauri/installer/installer.nsi', import.meta.url),
    'utf8',
  )
  const translations = await readFile(
    new URL('../src-tauri/installer/SimpChinese.nsh', import.meta.url),
    'utf8',
  )
  assert(!translations.includes('{{'), 'NSIS language files are not Handlebars templates')
  const defined = new Set(
    [...`${template}\n${translations}`.matchAll(/^LangString\s+(\w+)\s/gm)].map(
      (match) => match[1],
    ),
  )
  for (const [, message] of template.matchAll(/\$\(([a-z]\w*)\)/g))
    assert(defined.has(message), `missing Chinese translation: ${message}`)
})
