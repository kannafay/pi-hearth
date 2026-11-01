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
  for (const file of [nsis.template, nsis.installerHooks, nsis.customLanguageFiles.SimpChinese])
    assert((await readFile(new URL(`../src-tauri/${file}`, import.meta.url))).length > 0)
})

test('installer branding uses high-resolution native bitmaps without a rasterized wordmark', async () => {
  const config = JSON.parse(
    await readFile(new URL('../src-tauri/tauri.windows.conf.json', import.meta.url), 'utf8'),
  )
  const nsis = config.bundle.windows.nsis
  for (const [file, width, height] of [
    [nsis.headerImage, 192, 192],
    [nsis.sidebarImage, 492, 846],
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
  const svg = await readFile(new URL('../public/pi.svg', import.meta.url), 'utf8')
  const palette = new Set([
    0xffffff,
    ...[...svg.matchAll(/fill="#([0-9A-Fa-f]{6})"/g)].map((match) => parseInt(match[1], 16)),
  ])
  const header = await readFile(new URL(`../src-tauri/${nsis.headerImage}`, import.meta.url))
  const colors = new Set()
  for (let pixel = header.readUInt32LE(10); pixel < header.length; pixel += 3)
    colors.add(header.readUIntLE(pixel, 3))
  assert.deepEqual(
    colors,
    palette,
    'the pixel logo must retain its SVG colors without blur or text',
  )
})

test('compact installer UI contains every required native dialog and no executable code', async () => {
  const bytes = await readFile(new URL('../src-tauri/installer/compact-ui.dll', import.meta.url))
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ')
  const pe = bytes.readUInt32LE(0x3c)
  assert.equal(bytes.toString('ascii', pe, pe + 4), 'PE\0\0')
  assert.equal(bytes.readUInt16LE(pe + 4), 0x14c, 'NSIS uses x86 dialog resources')
  const optional = pe + 24
  assert.equal(bytes.readUInt16LE(optional), 0x10b)
  assert.equal(bytes.readUInt32LE(optional + 4), 0, 'resource-only DLL must contain no code')
  assert.equal(bytes.readUInt32LE(optional + 16), 0, 'resource-only DLL must have no entry point')
  const sectionStart = optional + bytes.readUInt16LE(pe + 20)
  const toFileOffset = (rva) => {
    for (let index = 0; index < bytes.readUInt16LE(pe + 6); index++) {
      const section = sectionStart + index * 40
      const address = bytes.readUInt32LE(section + 12)
      if (rva >= address && rva < address + bytes.readUInt32LE(section + 8))
        return bytes.readUInt32LE(section + 20) + rva - address
    }
    throw new Error('resource address is outside the PE sections')
  }
  const resources = toFileOffset(bytes.readUInt32LE(optional + 112))
  const entries = (relative) => {
    const directory = resources + relative
    const count = bytes.readUInt16LE(directory + 12) + bytes.readUInt16LE(directory + 14)
    return Array.from({ length: count }, (_, index) => ({
      id: bytes.readUInt32LE(directory + 16 + index * 8),
      offset: bytes.readUInt32LE(directory + 20 + index * 8) & 0x7fffffff,
    }))
  }
  const dialogs = entries(entries(0).find((entry) => entry.id === 5).offset)
  assert.deepEqual(
    dialogs.map((entry) => entry.id),
    [102, 103, 104, 105, 106, 107, 108, 109, 111],
  )
  const main = dialogs.find((entry) => entry.id === 105)
  const data = resources + entries(main.offset)[0].offset
  const dialog = toFileOffset(bytes.readUInt32LE(data))
  assert(bytes.readUInt16LE(dialog + 24) < 200, 'outer dialog must retain the compact layout')
  assert(bytes.includes(Buffer.from('Pi Hearth', 'utf16le')), 'brand name must remain native text')
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
