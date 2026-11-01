import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function checkRustEnvironment({ run = spawnSync, platform = process.platform } = {}) {
  const failures = []
  for (const command of ['cargo', 'rustc']) {
    const result = run(command, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      env: { ...process.env, RUSTUP_AUTO_INSTALL: '0' },
    })
    if (!result.error && result.status === 0) continue
    if (result.error?.code === 'ENOENT') {
      failures.push(`找不到 ${command} 命令。`)
    } else {
      const detail = result.stderr?.trim() || result.error?.message || `退出码 ${result.status}`
      failures.push(`${command} --version 执行失败：${detail}`)
    }
  }
  if (failures.length === 0) return null

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
