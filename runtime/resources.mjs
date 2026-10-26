import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const resolve = (value, base, home) =>
  path.resolve(
    base,
    value === '~' ? home : /^~[/\\]/.test(value) ? path.join(home, value.slice(2)) : value,
  )

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
