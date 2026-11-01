import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function checkWindowsBuildEnvironment(run, options) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pi-hearth-build-preflight-'))
  try {
    const manifest = path.join(directory, 'Cargo.toml')
    writeFileSync(
      manifest,
      '[package]\nname = "pi-hearth-preflight"\nversion = "0.0.0"\nedition = "2024"\n\n[[bin]]\nname = "pi-hearth-preflight"\npath = "main.rs"\n',
    )
    writeFileSync(path.join(directory, 'main.rs'), 'fn main() {}\n')
    // Let Cargo discover the same linker/configuration as the app, including tools outside PATH.
    const result = run(
      'cargo',
      [
        'build',
        '--manifest-path',
        manifest,
        '--target-dir',
        path.join(directory, 'target'),
        '--offline',
        '--quiet',
      ],
      { ...options, timeout: 30_000 },
    )
    if (!result.error && result.status === 0) return null
    const detail = result.stderr?.trim() || result.error?.message || `退出码 ${result.status}`
    const reason = /linker .*link\.exe.*not found/i.test(detail)
      ? 'Rust 已可用，但未找到 MSVC 链接器 link.exe。'
      : 'Rust 已可用，但最小程序未能完成编译和链接。'
    const lines = detail.split(/\r?\n/)
    const diagnostic = lines.find((line) => /error[: ]|LNK\d/i.test(line)) || lines[0]
    return [
      '无法启动桌面开发：Windows 编译环境检查未通过。',
      reason,
      '请检查 MSVC C++ Build Tools 和 Windows SDK 是否安装完整。',
      '',
      '请在管理员终端手动执行安装命令（本检查不会自动安装）：',
      '  winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --override "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
      '已安装时，请在 Visual Studio Installer 中选择“修改”，勾选“使用 C++ 的桌面开发”，确认包含 MSVC x64/x86 生成工具和 Windows SDK。',
      '安装完成后重新打开终端，再运行 pnpm desktop。',
      'Tauri 环境要求：https://v2.tauri.app/start/prerequisites/',
      '',
      `检测详情：${diagnostic}`,
    ].join('\n')
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
  }
}

export function checkRustEnvironment({ run = spawnSync, platform = process.platform } = {}) {
  const options = {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    env: { ...process.env, RUSTUP_AUTO_INSTALL: '0' },
  }
  const failures = []
  for (const command of ['cargo', 'rustc']) {
    const result = run(command, ['--version'], options)
    if (!result.error && result.status === 0) continue
    if (result.error?.code === 'ENOENT') {
      failures.push(`找不到 ${command} 命令。`)
    } else {
      const detail = result.stderr?.trim() || result.error?.message || `退出码 ${result.status}`
      failures.push(`${command} --version 执行失败：${detail}`)
    }
  }
  if (failures.length === 0) {
    if (platform !== 'win32') return null
    try {
      return checkWindowsBuildEnvironment(run, options)
    } catch (error) {
      return `无法启动桌面开发：Windows 编译环境检查失败。\n检测详情：${error.message}`
    }
  }

  const windows = platform === 'win32'
  const install = windows
    ? 'winget install --id Rustlang.Rustup --exact'
    : "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  const cargoBin = windows ? '%USERPROFILE%\\.cargo\\bin' : '$HOME/.cargo/bin'
  return [
    '无法启动桌面开发：Rust 开发环境缺失或不可用。',
    ...failures.map((failure) => `- ${failure}`),
    '',
    '尚未安装 Rust 时，请手动执行安装命令（本检查不会自动安装）：',
    `  ${install}`,
    '也可从 https://rustup.rs/ 获取安装说明。',
    '已安装 rustup 但缺少 stable 工具链时，请手动执行：',
    '  rustup toolchain install stable',
    '',
    `安装后重新打开终端；若仍找不到命令，请检查 PATH 中的 Cargo bin 目录（默认为 ${cargoBin}，自定义 CARGO_HOME 时为其 bin 子目录）。`,
    '确认 cargo --version 和 rustc --version 均成功后，再运行 pnpm desktop。',
    ...(windows
      ? ['Windows 请使用 MSVC 工具链，并准备 C++ Build Tools、Windows SDK 与 WebView2。']
      : []),
    'Tauri 环境要求：https://v2.tauri.app/start/prerequisites/',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const error = checkRustEnvironment()
  if (error) {
    console.error(error)
    process.exitCode = 1
  }
}
