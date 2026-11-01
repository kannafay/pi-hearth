import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ownedPath } from './prepare-runtime.mjs'

export function cleanEnvironment(environment) {
  const result = {}
  for (const key of [
    'SystemRoot',
    'SystemDrive',
    'WINDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'COMSPEC',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
  ])
    if (environment[key]) result[key] = environment[key]
  const windows = environment.SystemRoot || 'C:\\Windows'
  result.PATH = [
    path.join(windows, 'System32'),
    windows,
    path.join(windows, 'System32/WindowsPowerShell/v1.0'),
  ].join(path.delimiter)
  result.NODE_OPTIONS = '--require=pi-hearth-must-not-use-external-node-options'
  result.NODE_PATH = path.join(os.tmpdir(), 'pi-hearth-no-global-node-modules')
  return result
}

export async function verifyInstallation(directory, reportFile) {
  if (process.platform !== 'win32') throw new Error('安装检查仅支持 Windows。')
  directory = path.resolve(directory)
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'hearth-install-中文 空格-'))
  const report = path.join(temporary, 'report.json')
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(path.join(directory, 'Pi Hearth.exe'), ['--runtime-check', report], {
        cwd: temporary,
        env: cleanEnvironment(process.env),
        windowsHide: true,
        stdio: 'ignore',
        timeout: 120_000,
      })
      child.once('error', reject)
      child.once('exit', resolve)
    })
    const result = JSON.parse(await readFile(report, 'utf8'))
    if (code !== 0 || result.success !== true)
      throw new Error(result.error || `安装检查失败：${code}`)
    ownedPath(directory, result.nodeExecutable)
    ownedPath(directory, result.piEntrypoint)
    if (reportFile) await writeFile(reportFile, JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result))
    return result
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    console.error('用法：pnpm runtime:verify <已安装的应用目录> [报告文件]')
    process.exitCode = 1
  } else
    verifyInstallation(process.argv[2], process.argv[3]).catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
