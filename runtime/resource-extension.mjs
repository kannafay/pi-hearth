import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resourceCatalog, resourceEnabled, readResourcePreferences } from './resources.mjs'

export const reloadResourcesCommand = 'hearth-resources-reload'

export function selectedMcpConfig(loaded, preferences) {
  return {
    ...loaded,
    autoEnableCodemode: false,
    errors: loaded.errors.length ? ['MCP 配置有误，请检查配置文件。'] : [],
    servers: loaded.servers
      .filter((entry) =>
        resourceEnabled(
          preferences,
          'mcp',
          entry.override || entry.source,
          entry.name,
          entry.config.enabled !== false,
        ),
      )
      .map((entry) => ({
        ...entry,
        // The desktop exposes enabled MCP tools directly; codemode is not loaded.
        config: { ...entry.config, enabled: true, exposure: 'direct' },
      })),
  }
}

export default async function registerResources(pi) {
  const configFile = process.env.HEARTH_RESOURCES_CONFIG
  const agentDir = process.env.HEARTH_SOURCE_AGENT_DIR
  const modules = process.env.HEARTH_PI_MODULES
  if (!configFile || !agentDir || !modules) return
  const module = (file) => import(pathToFileURL(path.join(modules, file)).href)
  pi.registerCommand(reloadResourcesCommand, {
    description: 'pi-hearth resource settings',
    handler: async (args, ctx) => {
      const [token, revision, extra] = args.trim().split(/\s+/)
      if (
        token !== process.env.HEARTH_MESSAGE_ACTION_TOKEN ||
        !/^[\w-]{1,80}$/.test(revision ?? '') ||
        extra
      )
        throw new Error('无效的资源操作。')
      if (!ctx.isIdle()) throw new Error('请等待当前回复结束。')
      await ctx.reload()
      // Pi reports extension-command failures separately from its RPC response.
      // A unique acknowledgement prevents a swallowed reload error from checking the switch.
      await writeFile(process.env.HEARTH_RESOURCES_ACK, revision)
    },
  })
  pi.on('resources_discover', async (event) => {
    const preferences = await readResourcePreferences(configFile)
    const sdk = await module('core/skills.js')
    const found = await resourceCatalog(
      { projectPath: event.cwd },
      {
        ...sdk,
        loadMcpConfig: () => ({ servers: [], errors: [] }),
      },
      agentDir,
    )
    return {
      skillPaths: found.skills
        .filter((item) =>
          resourceEnabled(preferences, 'skills', item.source, item.name, item.enabled),
        )
        .map((item) => item.source),
    }
  })
  const preferences = await readResourcePreferences(configFile)
  const [{ createMcpExtension }, { loadMcpConfig }] = await Promise.all([
    module('extensions/mcp/index.js'),
    module('extensions/mcp/config.js'),
  ])
  await createMcpExtension({
    loadConfig: (ctx) =>
      selectedMcpConfig(
        loadMcpConfig({ agentDir, cwd: ctx.cwd, projectTrusted: true }),
        preferences,
      ),
    updateConfig: () => {
      throw new Error('请在 Pi Hearth 设置中更改启停状态。')
    },
    startupWaitMs: 10000,
  })(pi)
}
