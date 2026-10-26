import { useWorkspaceStore } from '@/app/store'
import { loadComposerCommands } from '@/lib/composer'
import { isCurrentSession } from '@/lib/session-preferences'
import { slashCommand } from './composer-completion'
import { toast } from '@/lib/toast'
import { modelKey } from './models'
import { useConversationStore } from './store'

export interface ComposerActions {
  onSettings?: () => void
  onResume?: () => void
  onRename?: () => void
}

// null means a regular prompt (including a validated skill invocation).
export async function executeComposerCommand(
  text: string,
  attachmentCount: number,
  actions: ComposerActions & { onPicker: (picker: 'model' | 'thinking') => void },
): Promise<boolean | null> {
  const command = slashCommand(text)
  if (!command) return null
  const state = useConversationStore.getState()
  const workspace = useWorkspaceStore.getState()
  if (!state.instanceId || state.status !== 'ready' || state.readOnly || state.settingsPending)
    return false
  const { name, args } = command
  function complete(success: boolean, message: string) {
    if (success && useConversationStore.getState().instanceId === state.instanceId)
      toast.success(message)
    return success
  }
  if (name.startsWith('skill:')) {
    const commands = await loadComposerCommands(state.instanceId)
    if (useConversationStore.getState().instanceId !== state.instanceId) return false
    if (!commands.some((command) => command.name === name))
      throw new Error('此技能未启用或已不存在，请检查技能设置。')
    return null
  }
  if (attachmentCount) throw new Error('此命令不接收附件，请先移除附件。')
  if (['new', 'resume', 'settings'].includes(name) && args) throw new Error(`/${name} 不需要参数。`)
  switch (name) {
    case 'new':
      await workspace.newConversation(workspace.projectPath)
      return !useWorkspaceStore.getState().error
    case 'resume':
      if (!actions.onResume) throw new Error('暂时无法打开会话列表。')
      actions.onResume()
      return true
    case 'settings':
      if (!actions.onSettings) throw new Error('暂时无法打开设置。')
      actions.onSettings()
      return true
    case 'name': {
      const session = workspace.sessions.find((session) => isCurrentSession(session, state))
      if (!session) throw new Error('请先发送一条消息，再为会话命名。')
      if (args) {
        await workspace.renameSession(session, args)
        return complete(!useWorkspaceStore.getState().error, '会话已重命名')
      } else {
        if (!actions.onRename) throw new Error('暂时无法重命名此会话。')
        actions.onRename()
      }
      return true
    }
    case 'model': {
      if (!args) {
        actions.onPicker('model')
        return true
      }
      const models = state.models.map(
        (model) => state.modelCatalog?.find((item) => modelKey(item) === modelKey(model)) ?? model,
      )
      const matches = models.filter((model) =>
        [modelKey(model), model.id, model.name].some(
          (value) => value.toLowerCase() === args.toLowerCase(),
        ),
      )
      if (matches.length !== 1)
        throw new Error(
          matches.length
            ? '存在同名模型，请使用 provider/model 指定。'
            : '未找到此模型，请使用 /model 打开模型列表。',
        )
      await state.changeModel(matches[0])
      return complete(!useConversationStore.getState().error, '模型已切换')
    }
    case 'thinking': {
      if (!args) {
        actions.onPicker('thinking')
        return true
      }
      const level = args.toLowerCase()
      if (level !== 'default' && !state.availableThinkingLevels.includes(level))
        throw new Error('当前模型不支持这个思考档位。')
      await state.changeThinkingLevel(level)
      return complete(!useConversationStore.getState().error, '思考强度已更新')
    }
    case 'compact':
      if (!state.messages.length) throw new Error('当前对话暂无需要压缩的内容。')
      return complete(await state.compact(args), '上下文已压缩')
    default:
      throw new Error(`未支持的命令 /${name}。输入 / 查看可用命令。`)
  }
}
