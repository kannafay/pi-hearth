import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function checkTarget(platform, arch, target, expected) {
  if (platform !== 'win32' || arch !== 'x64' || (target && target !== expected))
    throw new Error(`目前仅支持 Windows x64 安装包（${expected}）。`)
}

export function verifyArchive(bytes, expected) {
  if (sha256(bytes) !== expected) throw new Error('Node.js 下载文件 SHA-256 校验失败，已停止打包。')
}

export function ownedPath(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target))
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error('运行时临时目录超出预期范围。')
  return target
}

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`运行时准备失败：${path.basename(file)} 退出码 ${code}`)),
    )
  })
}

async function pnpm(args) {
  const executable = process.env.npm_execpath
  if (!executable) throw new Error('请使用 pnpm runtime:prepare 准备运行时。')
  await run(
    /\.exe$/i.test(executable) ? executable : process.execPath,
    /\.exe$/i.test(executable) ? args : [executable, ...args],
  )
}

export async function assertPortable(directory) {
  for (const name of await readdir(directory)) {
    const file = path.join(directory, name)
    const info = await lstat(file)
    if (info.isSymbolicLink()) throw new Error(`运行时包含链接，不能用于安装包：${file}`)
    if (info.isDirectory()) await assertPortable(file)
  }
}

export async function prepareRuntime() {
  const config = await readJson(path.join(root, 'runtime/windows-runtime.json'))
  checkTarget(process.platform, process.arch, process.env.TAURI_ENV_TARGET_TRIPLE, config.target)
  const project = await readJson(path.join(root, 'package.json'))
  const runtime = await readJson(path.join(root, 'runtime/package.json'))
  const piVersion = runtime.dependencies['@earendil-works/pi-coding-agent']
  if (piVersion !== project.devDependencies['@earendil-works/pi-coding-agent'])
    throw new Error('开发与安装包的 Pi 运行时版本不一致。')

  const work = path.join(root, 'work')
  const cache = path.join(work, 'downloads')
  await mkdir(cache, { recursive: true })
  const archiveName = `node-v${config.nodeVersion}-win-x64.zip`
  const archive = path.join(cache, archiveName)
  let bytes
  try {
    bytes = await readFile(archive)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    console.log(`下载官方 Node.js ${config.nodeVersion}…`)
    const response = await fetch(`https://nodejs.org/dist/v${config.nodeVersion}/${archiveName}`, {
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error(`Node.js 下载失败：HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
    verifyArchive(bytes, config.nodeArchiveSha256)
    await writeFile(`${archive}.tmp`, bytes)
    await rename(`${archive}.tmp`, archive)
  }
  verifyArchive(bytes, config.nodeArchiveSha256)
  const temporary = await mkdtemp(path.join(work, 'runtime-package-'))
  try {
    const extracted = path.join(temporary, 'extracted')
    const stage = path.join(temporary, 'runtime')
    await mkdir(stage)
    await run(
      path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $env:HEARTH_NODE_ARCHIVE -DestinationPath $env:HEARTH_NODE_EXTRACT',
      ],
      { env: { ...process.env, HEARTH_NODE_ARCHIVE: archive, HEARTH_NODE_EXTRACT: extracted } },
    )
    await cp(
      path.join(extracted, `node-v${config.nodeVersion}-win-x64`),
      path.join(stage, 'node'),
      { recursive: true },
    )
    await cp(path.join(root, 'runtime/licenses'), path.join(stage, 'licenses'), { recursive: true })
    await rm(path.join(stage, 'node/install_tools.bat'), { force: true })
    await pnpm([
      '--filter',
      '@pi-hearth/runtime',
      '--prod',
      '--config.node-linker=hoisted',
      'deploy',
      path.join(stage, 'pi'),
      '--ignore-scripts',
      '--offline',
    ])
    await assertPortable(stage)
    const pi = await readJson(
      path.join(stage, 'pi/node_modules/@earendil-works/pi-coding-agent/package.json'),
    )
    if (pi.version !== piVersion) throw new Error('部署的 Pi 版本与锁定版本不一致。')
    await writeFile(
      path.join(stage, 'manifest.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          target: config.target,
          nodeVersion: config.nodeVersion,
          piVersion,
          lockSha256: sha256(await readFile(path.join(root, 'pnpm-lock.yaml'))),
        },
        null,
        2,
      ) + '\n',
    )
    await writeFile(
      path.join(stage, 'THIRD_PARTY_NOTICES.md'),
      '# Third-party runtime components\n\nNode.js: see node/LICENSE.\n\nPi Coding Agent and the @earendil-works/pi-* components (https://github.com/earendil-works/pi, v1.3.0): see licenses/pi-MIT.txt.\n\nOther Pi dependencies: see pi/node_modules/*/LICENSE* and package.json license metadata.\n\nThe runtime is distributed with its dependencies and upstream license files.\n',
    )
    // Check the copied runtime before publishing any resources used by Tauri.
    await run(path.join(stage, 'node/node.exe'), [path.join(stage, 'pi/runtime-smoke.mjs')])
    const destination = path.join(root, 'src-tauri/bundle-runtime')
    await mkdir(destination, { recursive: true })
    await rm(ownedPath(destination, path.join(destination, 'manifest.json')), { force: true })
    for (const name of ['node', 'pi', 'licenses', 'THIRD_PARTY_NOTICES.md']) {
      const target = ownedPath(destination, path.join(destination, name))
      await rm(target, { recursive: true, force: true })
      await rename(path.join(stage, name), target)
    }
    await rename(path.join(stage, 'manifest.json'), path.join(destination, 'manifest.json'))
    console.log(`Windows 运行时已准备：Node.js ${config.nodeVersion} / Pi ${piVersion}`)
  } finally {
    await rm(ownedPath(work, temporary), { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  prepareRuntime().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
