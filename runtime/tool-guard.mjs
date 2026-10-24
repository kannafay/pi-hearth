import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareFileStorage } from './file-storage.mjs'

export const guardCommand = 'hearth-guard-ready'
export const approvalKind = 'pi-hearth-tool-approval-v1'
export const rewindCommand = 'hearth-message-rewind'

export async function rewindMessage(pi, args, ctx, token) {
  const [provided, entryId, extra] = args.trim().split(/\s+/)
  if (!token || provided !== token || extra || !/^[\w-]{1,128}$/.test(entryId ?? ''))
    throw new Error('无效的消息操作。')
  if (!ctx.isIdle()) throw new Error('请等待当前回复结束。')
  const entry = ctx.sessionManager.getBranch().find((item) => item.id === entryId)
  if (entry?.type !== 'message' || entry.message.role !== 'user')
    throw new Error('这条消息不在当前会话中。')
  // navigateTree treats selecting the current leaf as a no-op. A metadata
  // entry allows retrying even when the failed run only persisted its prompt.
  if (ctx.sessionManager.getLeafId() === entryId) pi.appendEntry('hearth-message-retry', {})
  const result = await ctx.navigateTree(entryId, { summarize: false })
  if (result.cancelled) throw new Error('已取消消息操作。')
}

// Match Pi's accepted path spellings before testing the real filesystem path.
export function resolveToolPath(input, cwd) {
  let value = input.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
  if (value.startsWith('@')) value = value.slice(1)
  if (value.startsWith('file://')) value = fileURLToPath(value)
  if (process.platform === 'win32' && !value.includes('\\') && !value.startsWith('//')) {
    value = value.replace(/^\/(?:mnt\/|cygdrive\/)?([a-zA-Z])(?:\/|$)/, '$1:/')
  }
  if (value === '~') value = homedir()
  else if (value.startsWith('~/') || (process.platform === 'win32' && value.startsWith('~\\'))) {
    value = path.join(homedir(), value.slice(2))
  }
  return path.resolve(cwd, value)
}

export async function isProjectRead(input, cwd) {
  try {
    const [root, target] = await Promise.all([realpath(cwd), realpath(input)])
    const relative = path.relative(root, target)
    return (
      relative === '' ||
      (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
    )
  } catch {
    // Missing or inaccessible paths require approval too; never guess containment.
    return false
  }
}

export async function guardTool(event, ctx) {
  if (!['read', 'write', 'edit', 'bash', 'powershell'].includes(event.toolName)) {
    return { block: true, reason: '此工具尚未在 pi-hearth 中启用。' }
  }
  try {
    if (typeof event.input.path === 'string') {
      event.input.path = resolveToolPath(event.input.path, ctx.cwd)
      if (event.toolName === 'read') {
        const target = await realpath(event.input.path).catch(() => null)
        if (target && (await isProjectRead(target, ctx.cwd))) {
          event.input.path = target
          return
        }
      }
    }
    if (!ctx.hasUI || ctx.signal?.aborted)
      return { block: true, reason: '工具确认不可用或任务已停止。' }
    const allowed = await ctx.ui.confirm(
      '确认工具调用',
      JSON.stringify({
        kind: approvalKind,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.input,
        cwd: ctx.cwd,
      }),
      { timeout: 120_000, signal: ctx.signal },
    )
    if (!allowed || ctx.signal?.aborted)
      return { block: true, reason: '用户拒绝、确认超时或任务已停止。' }
  } catch {
    return { block: true, reason: '无法完成工具确认，已阻止执行。' }
  }
}

export default function registerGuard(pi) {
  pi.on('tool_call', guardTool)
  pi.on('before_agent_start', (event, ctx) =>
    prepareFileStorage(event, ctx, pi, process.env.HEARTH_FILE_STORAGE_CONFIG),
  )
  // Rust checks this marker before exposing a connected runtime to the UI.
  pi.registerCommand(guardCommand, {
    description: 'pi-hearth tool approval guard',
    handler: async () => {},
  })
  pi.registerCommand(rewindCommand, {
    description: 'pi-hearth message actions',
    handler: (args, ctx) => rewindMessage(pi, args, ctx, process.env.HEARTH_MESSAGE_ACTION_TOKEN),
  })
}
