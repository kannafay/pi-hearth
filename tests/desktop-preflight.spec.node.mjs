import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
    platform: 'linux',
    run: (command) => {
      commands.push(command)
      return success
    },
  })
  assert.equal(error, null)
  assert.deepEqual(commands, ['cargo', 'rustc'])
})

test('Windows verifies linking through Cargo offline and cleans the temporary project', () => {
  const commands = []
  let directory
  const error = checkRustEnvironment({
    platform: 'win32',
    run: (command, args, options) => {
      commands.push(command)
      if (args[0] !== 'build') return success
      assert.equal(command, 'cargo')
      assert.ok(args.includes('--offline'))
      assert.ok(args.includes('--quiet'))
      assert.equal(options.env.RUSTUP_AUTO_INSTALL, '0')
      assert.equal(options.timeout, 30_000)
      assert.ok(!options.shell)
      // Keep the caller's working directory so Cargo discovers its normal configuration.
      assert.equal(options.cwd, undefined)
      const manifest = args[args.indexOf('--manifest-path') + 1]
      directory = path.dirname(manifest)
      assert.equal(args[args.indexOf('--target-dir') + 1], path.join(directory, 'target'))
      const content = readFileSync(manifest, 'utf8')
      assert.match(content, /edition = "2024"/)
      assert.doesNotMatch(content, /\[dependencies\]/)
      assert.equal(readFileSync(path.join(directory, 'main.rs'), 'utf8'), 'fn main() {}\n')
      return success
    },
  })
  assert.equal(error, null)
  assert.deepEqual(commands, ['cargo', 'rustc', 'cargo'])
  assert.ok(directory)
  assert.equal(existsSync(directory), false)
})

test('missing MSVC or SDK reports Chinese Build Tools guidance instead of Rust installation', () => {
  for (const cause of [
    'error: linker `link.exe` not found',
    "LINK : fatal error LNK1104: cannot open file 'kernel32.lib'",
  ]) {
    let directory
    const error = checkRustEnvironment({
      platform: 'win32',
      run: (_command, args) => {
        if (args[0] !== 'build') return success
        directory = path.dirname(args[args.indexOf('--manifest-path') + 1])
        return {
          status: 101,
          stderr: `${cause}\n\nnote: verbose compiler context\nerror: could not compile preflight`,
        }
      },
    })
    assert.match(error, /Windows 编译环境检查未通过/)
    assert.match(error, /Rust 已可用/)
    assert.match(error, /MSVC C\+\+ Build Tools.*Windows SDK/)
    assert.match(error, /管理员终端.*不会自动安装/)
    assert.match(error, /winget install --id Microsoft\.VisualStudio\.2022\.BuildTools/)
    assert.match(error, /Microsoft\.VisualStudio\.Workload\.VCTools --includeRecommended/)
    assert.match(error, /使用 C\+\+ 的桌面开发/)
    assert.match(error, /重新打开终端/)
    assert.ok(error.includes(cause))
    assert.doesNotMatch(error, /verbose compiler context|could not compile/)
    assert.doesNotMatch(error, /Rustlang\.Rustup|rustup toolchain install/)
    assert.ok(directory)
    assert.equal(existsSync(directory), false)
  }
})

test('a timed-out Windows build probe fails with a readable diagnostic and cleans up', () => {
  let directory
  const error = checkRustEnvironment({
    platform: 'win32',
    run: (_command, args) => {
      if (args[0] !== 'build') return success
      directory = path.dirname(args[args.indexOf('--manifest-path') + 1])
      return { status: null, error: { code: 'ETIMEDOUT', message: 'spawn cargo ETIMEDOUT' } }
    },
  })
  assert.match(error, /Windows 编译环境检查未通过/)
  assert.match(error, /ETIMEDOUT/)
  assert.equal(existsSync(directory), false)
})

test('an unexpected Windows probe error stays readable and cleans the temporary project', () => {
  let directory
  const error = checkRustEnvironment({
    platform: 'win32',
    run: (_command, args) => {
      if (args[0] !== 'build') return success
      directory = path.dirname(args[args.indexOf('--manifest-path') + 1])
      throw new Error('test probe failure')
    },
  })
  assert.match(error, /Windows 编译环境检查失败/)
  assert.match(error, /test probe failure/)
  assert.equal(existsSync(directory), false)
})

test('non-Windows hosts only check Rust and do not build the Windows probe', () => {
  for (const platform of ['darwin', 'linux']) {
    const calls = []
    const error = checkRustEnvironment({
      platform,
      run: (_command, args) => {
        calls.push(args)
        return success
      },
    })
    assert.equal(error, null)
    assert.deepEqual(calls, [['--version'], ['--version']])
  }
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
