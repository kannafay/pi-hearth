import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRustEnvironment } from '../scripts/check-rust.mjs'

const success = { status: 0, stdout: '', stderr: '' }
const missing = { status: null, error: { code: 'ENOENT' } }

test('missing Rust reports Chinese installation and PATH instructions without installing', () => {
  const calls = []
  const previousAutoInstall = process.env.RUSTUP_AUTO_INSTALL
  const error = checkRustEnvironment({
    platform: 'win32',
    run: (...args) => {
      calls.push(args)
      return missing
    },
  })
  assert.match(error, /Rust 开发环境缺失或不可用/)
  assert.match(error, /找不到 cargo 命令/)
  assert.match(error, /找不到 rustc 命令/)
  assert.match(error, /winget install --id Rustlang\.Rustup --exact/)
  assert.match(error, /不会自动安装/)
  assert.match(error, /重新打开终端/)
  assert.match(error, /PATH.*%USERPROFILE%\\\.cargo\\bin.*CARGO_HOME/)
  assert.match(error, /MSVC.*C\+\+ Build Tools.*Windows SDK.*WebView2/)
  assert.deepEqual(
    calls.map(([command, args]) => [command, args]),
    [
      ['cargo', ['--version']],
      ['rustc', ['--version']],
    ],
  )
  for (const [, , options] of calls) {
    assert.equal(options.env.RUSTUP_AUTO_INSTALL, '0')
    assert.equal(options.windowsHide, true)
    assert.equal(options.timeout, 10_000)
    assert.ok(!options.shell)
  }
  assert.equal(process.env.RUSTUP_AUTO_INSTALL, previousAutoInstall)
})

test('an available Rust toolchain passes the preflight without a message', () => {
  const commands = []
  const error = checkRustEnvironment({
    run: (command) => {
      commands.push(command)
      return success
    },
  })
  assert.equal(error, null)
  assert.deepEqual(commands, ['cargo', 'rustc'])
})

test('Cargo alone is insufficient when the Rust compiler is missing', () => {
  const error = checkRustEnvironment({
    run: (command) => (command === 'cargo' ? success : missing),
  })
  assert.match(error, /找不到 rustc 命令/)
  assert.doesNotMatch(error, /找不到 cargo 命令/)
})

test('an installed proxy with a missing toolchain reports its error and a manual repair command', () => {
  const error = checkRustEnvironment({
    run: (command) =>
      command === 'cargo'
        ? { status: 1, stderr: "error: toolchain 'stable' is not installed\n" }
        : success,
  })
  assert.match(error, /cargo --version 执行失败：error: toolchain 'stable' is not installed/)
  assert.match(error, /rustup toolchain install stable/)
  assert.doesNotMatch(error, /找不到 cargo 命令/)
})

test('probe execution errors and timeouts fail the preflight with their cause', () => {
  for (const code of ['EACCES', 'ETIMEDOUT']) {
    const error = checkRustEnvironment({
      run: () => ({ status: null, error: { code, message: `spawn failed: ${code}` } }),
    })
    assert.ok(error.includes(`执行失败：spawn failed: ${code}`))
    assert.doesNotMatch(error, /找不到 cargo 命令/)
  }
})

test('macOS and Linux receive a Unix installation command and PATH instead of Windows guidance', () => {
  for (const platform of ['darwin', 'linux']) {
    const error = checkRustEnvironment({ platform, run: () => missing })
    assert.match(error, /curl --proto '=https' --tlsv1\.2 -sSf https:\/\/sh\.rustup\.rs \| sh/)
    assert.ok(error.includes('$HOME/.cargo/bin'))
    assert.doesNotMatch(error, /winget|%USERPROFILE%|MSVC/)
  }
})

test('the CLI exits with a Chinese error when neither Rust command is on PATH', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pi-hearth-rust-preflight-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'),
  )
  env.PATH = directory
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../scripts/check-rust.mjs', import.meta.url))],
    { cwd: directory, env, encoding: 'utf8', timeout: 10_000, windowsHide: true },
  )
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /无法启动桌面开发/)
  assert.match(result.stderr, /找不到 cargo 命令/)
  assert.match(result.stderr, /找不到 rustc 命令/)
  assert.match(result.stderr, /安装命令/)
  assert.doesNotMatch(result.stderr, /cargo metadata|Error: spawn/)
})
