import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
const expand = (value, cwd) =>
  path.resolve(
    cwd,
    value === '~'
      ? homedir()
      : value.startsWith('~/')
        ? path.join(homedir(), value.slice(2))
        : value,
  )

async function settings(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error(`无法读取 Pi 设置: ${file}`)
  }
}

export async function sessionDirectory(cwd, agentDir, sdk) {
  const global = await settings(path.join(agentDir, 'settings.json'))
  const local = await settings(path.join(cwd, '.pi', 'settings.json'))
  const custom = process.env.PI_CODING_AGENT_SESSION_DIR || local.sessionDir || global.sessionDir
  return custom ? expand(custom, cwd) : sdk.getDefaultSessionDir(cwd, agentDir)
}

export async function catalog(request, sdk, agentDir) {
  const roots = new Set([request.legacyDir])
  const global = await settings(path.join(agentDir, 'settings.json'))
  if (process.env.PI_CODING_AGENT_SESSION_DIR || global.sessionDir)
    roots.add(expand(process.env.PI_CODING_AGENT_SESSION_DIR || global.sessionDir, agentDir))
  for (const project of request.projects ?? []) {
    const local = await settings(path.join(project, '.pi', 'settings.json'))
    if (local.sessionDir) roots.add(expand(local.sessionDir, project))
  }
  const groups = await Promise.all([
    sdk.SessionManager.listAll(),
    ...[...roots].filter(Boolean).map((root) => sdk.SessionManager.listAll(root)),
  ])
  const seen = new Set()
  const sessions = []
  for (const item of groups.flat()) {
    const file = await realpath(item.path).catch(() => item.path)
    const key = normalize(file)
    if (seen.has(key)) continue
    seen.add(key)
    sessions.push({
      path: file,
      id: item.id,
      cwd: item.cwd,
      title: (item.name || item.firstMessage || '未命名会话').slice(0, 160),
      modified: item.modified.getTime(),
      messageCount: item.messageCount,
    })
  }
  return sessions.sort((a, b) => b.modified - a.modified)
}

export async function renameSession(file, name, sdk) {
  const entries = sdk.parseSessionEntries(await readFile(file, 'utf8'))
  if (entries[0]?.type !== 'session') throw new Error('无效的 Pi 会话文件。')
  const manager = sdk.SessionManager.open(file)
  manager.appendSessionInfo(name)
  return manager.getSessionName()
}

// Read the active branch without opening/migrating/writing the source file.
export async function history(file, sdk) {
  const entries = sdk.parseSessionEntries(await readFile(file, 'utf8'))
  if (entries[0]?.type !== 'session') throw new Error('无效的 Pi 会话文件。')
  sdk.migrateSessionEntries(entries)
  const items = entries.filter((entry) => entry.type !== 'session')
  const index = new Map(items.map((entry) => [entry.id, entry]))
  const branch = []
  const seen = new Set()
  let cursor = items.at(-1)
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    branch.unshift(cursor)
    cursor = index.get(cursor.parentId)
  }
  return branch.flatMap((entry) => {
    if (entry.type === 'message' && entry.message.role !== 'system') {
      const finished = Date.parse(entry.timestamp)
      return [
        {
          ...entry.message,
          ...(Number.isFinite(finished) ? { __hearthFinishedAt: finished } : {}),
        },
      ]
    }
    if (entry.type === 'custom_message' && entry.display)
      return [{ role: 'assistant', content: entry.content }]
    if (entry.type === 'compaction' || entry.type === 'branch_summary')
      return [
        { role: 'assistant', content: [{ type: 'text', text: `上下文摘要\n\n${entry.summary}` }] },
      ]
    return []
  })
}

// Index only visible conversation text, not hidden reasoning or tool payloads.
export async function searchDocuments(files, sdk) {
  return Promise.all(
    files.map(async (file) => {
      try {
        const messages = await history(file, sdk)
        return {
          path: file,
          texts: messages
            .filter((message) => ['user', 'assistant'].includes(message.role))
            .map((message) =>
              typeof message.content === 'string'
                ? message.content
                : (message.content ?? [])
                    .filter((block) => block.type === 'text')
                    .map((block) => block.text)
                    .join('\n'),
            )
            .filter(Boolean),
        }
      } catch {
        // An externally removed/corrupt session must not hide all other results.
        return { path: file, texts: [] }
      }
    }),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sdk = await import(pathToFileURL(process.argv[2]).href)
    const request = JSON.parse(
      await new Promise((resolve, reject) => {
        let input = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (text) => {
          input += text
        })
        process.stdin.on('end', () => resolve(input))
        process.stdin.on('error', reject)
      }),
    )
    const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), '.pi', 'agent')
    let result
    if (request.action === 'list') result = await catalog(request, sdk, agentDir)
    else if (request.action === 'directory')
      result = await sessionDirectory(request.cwd, agentDir, sdk)
    else if (request.action === 'resources') {
      const { resourceCatalog } = await import('./resources.mjs')
      const skills = await import(new URL('./skills.js', pathToFileURL(process.argv[2])))
      const mcp = await import(
        new URL('../extensions/mcp/config.js', pathToFileURL(process.argv[2]))
      )
      result = await resourceCatalog(request, { ...skills, ...mcp }, agentDir)
    } else if (request.action === 'history') result = await history(request.path, sdk)
    else if (request.action === 'rename')
      result = await renameSession(request.path, request.name, sdk)
    else if (request.action === 'search_documents')
      result = await searchDocuments(request.paths, sdk)
    else throw new Error('不支持的会话操作。')
    process.stdout.write(JSON.stringify(result))
  } catch (error) {
    process.stderr.write(error.message)
    process.exitCode = 1
  }
}
