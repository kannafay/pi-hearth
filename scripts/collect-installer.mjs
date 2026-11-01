import { access, copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

export async function collectInstaller(projectRoot = root) {
  const config = JSON.parse(
    await readFile(path.join(projectRoot, 'src-tauri/tauri.conf.json'), 'utf8'),
  )
  const name = `${config.productName}_${config.version}_x64-setup.exe`
  const source = path.join(projectRoot, 'src-tauri/target/release/bundle/nsis', name)
  try {
    await access(source)
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`未找到当前版本的 Windows 安装包：${source}`)
    throw error
  }
  const directory = path.join(projectRoot, 'release')
  await mkdir(directory, { recursive: true })
  const destination = path.join(directory, name)
  await copyFile(source, destination)
  return destination
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  collectInstaller()
    .then((file) => console.log(`安装包已输出到：${file}`))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
