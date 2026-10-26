import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const resourceKey = (kind, source, name) => JSON.stringify([kind, source, name])

export function resourceEnabled(preferences, kind, source, name, configured = true) {
  const override = preferences[resourceKey(kind, source, name)]
  return typeof override === 'boolean' ? override : configured
}

export async function readResourcePreferences(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error('无法读取资源启停设置。')
  }
}

const resolve = (value, base, home) =>
  path.resolve(
    base,
    value === '~' ? home : /^~[/\\]/.test(value) ? path.join(home, value.slice(2)) : value,
  )

function mcpConfiguration(config) {
  const hidden = '[已隐藏]'
  const secrets = [...Object.values(config.env ?? {}), ...Object.values(config.headers ?? {})]
    .filter((value) => typeof value === 'string' && value)
    .flatMap((value) => [value, value.replace(/^(?:Bearer|Basic)\s+/i, '')])
    .filter(Boolean)
  const redact = (value) => secrets.reduce((text, secret) => text.split(secret).join(hidden), value)
  const address = (value) => {
    try {
      const url = new URL(value)
      return redact(`${url.origin}${url.pathname !== '/' || url.search || url.hash ? '/…' : ''}`)
    } catch {
      return hidden
    }
  }
  const preview = { type: config.command ? 'stdio' : 'http' }
  if (config.command) {
    preview.command = redact(config.command)
    let hideNext = false
    preview.args = (config.args ?? []).map((value) => {
      if (hideNext) {
        hideNext = false
        return hidden
      }
      const equals = value.indexOf('=')
      const option = equals < 0 ? value : value.slice(0, equals)
      if (
        ((option.startsWith('-') || equals >= 0) &&
          /token|secret|password|passwd|api[-_]?key|authorization|credential|header|cookie|auth/i.test(
            option,
          )) ||
        ['-H', '-e', '--eval', '-c', '--command'].includes(option)
      ) {
        hideNext = equals < 0
        return equals < 0 ? option : `${option}=${hidden}`
      }
      if (/^https?:\/\//i.test(value)) return address(value)
      if (equals >= 0 && /^https?:\/\//i.test(value.slice(equals + 1)))
        return `${option}=${address(value.slice(equals + 1))}`
      return redact(value)
    })
  }
  if (config.url) preview.url = address(config.url)
  for (const field of ['env', 'headers']) {
    if (config[field] && Object.keys(config[field]).length)
      preview[field] = Object.fromEntries(Object.keys(config[field]).map((key) => [key, hidden]))
  }
  return JSON.stringify(preview, null, 2)
}

async function skillPaths(base, warnings, label, home) {
  try {
    const settings = JSON.parse(await readFile(path.join(base, 'settings.json'), 'utf8'))
    const paths = settings.skills ?? []
    if (!Array.isArray(paths)) throw new Error('invalid settings')
    if (settings.packages?.length) warnings.push(`${label}配置包含资源包，本页暂不展开包内技能。`)
    const literal = paths.filter(
      (value) => typeof value === 'string' && !/^[!+-]/.test(value) && !/[*?{}[\]]/.test(value),
    )
    if (literal.length !== paths.length)
      warnings.push(`${label}配置包含技能筛选规则，本页仅展示目录中发现的技能。`)
    return literal.map((value) => resolve(value, base, home))
  } catch (error) {
    if (error.code !== 'ENOENT')
      warnings.push(`无法读取${label}技能路径配置，请检查 settings.json。`)
    return []
  }
}

// Inspect metadata only. Never connect to MCP transports or execute skill content.
export async function resourceCatalog(request, sdk, agentDir, home = homedir()) {
  const warnings = []
  const project = request.projectPath || null
  const roots = []
  if (project) {
    roots.push({ path: path.join(project, '.pi', 'skills'), scope: 'project' })
    // Pi also discovers .agents/skills from the project up to its repository root.
    let directory = path.resolve(project)
    while (true) {
      const skills = path.join(directory, '.agents', 'skills')
      if (skills !== path.join(home, '.agents', 'skills'))
        roots.push({ path: skills, scope: 'project' })
      const parent = path.dirname(directory)
      if (parent === directory || existsSync(path.join(directory, '.git'))) break
      directory = parent
    }
  }
  roots.push(
    { path: path.join(agentDir, 'skills'), scope: 'global' },
    { path: path.join(home, '.agents', 'skills'), scope: 'global' },
  )
  const paths = roots.filter((root) => existsSync(root.path)).map((root) => root.path)
  paths.push(...(await skillPaths(agentDir, warnings, '全局', home)))
  if (project)
    paths.push(...(await skillPaths(path.join(project, '.pi'), warnings, '当前项目', home)))
  let skills = []
  let mcp = []
  try {
    const loaded = sdk.loadSkills({
      cwd: project || agentDir,
      agentDir,
      skillPaths: paths,
      includeDefaults: false,
    })
    skills = loaded.skills.map((skill) => ({
      name: skill.name,
      description: skill.description.slice(0, 1024),
      source: skill.filePath,
      scope:
        roots.find((root) => {
          const relative = path.relative(root.path, skill.filePath)
          return (
            relative &&
            relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
          )
        })?.scope ?? 'custom',
      status: 'unloaded',
      manualOnly: skill.disableModelInvocation,
      enabled: true,
    }))
    if (loaded.diagnostics.length)
      warnings.push(`发现 ${loaded.diagnostics.length} 个技能格式或重名问题，部分条目可能未显示。`)
  } catch {
    warnings.push('无法扫描技能目录，请检查目录权限。')
  }
  try {
    const loaded = sdk.loadMcpConfig({
      agentDir,
      cwd: project || agentDir,
      projectTrusted: Boolean(project),
    })
    mcp = loaded.servers.map((entry) => ({
      name: entry.name,
      description: entry.config.command ? '本地命令服务' : '远程 HTTP 服务',
      source: entry.override || entry.source,
      scope: entry.override ? 'project' : entry.scope === 'project' ? 'project' : 'global',
      status: entry.config.enabled === false ? 'disabled' : 'unloaded',
      manualOnly: false,
      enabled: entry.config.enabled !== false,
      configuration: mcpConfiguration(entry.config),
    }))
    // Parser errors can contain credentials from malformed JSON. Return counts only.
    if (loaded.errors.length)
      warnings.push(
        `发现 ${loaded.errors.length} 个 MCP 配置问题，请检查全局或当前项目的 mcp.json。`,
      )
  } catch {
    warnings.push('无法读取 MCP 配置，请检查 mcp.json。')
  }
  return { skills, mcp, warnings }
}
