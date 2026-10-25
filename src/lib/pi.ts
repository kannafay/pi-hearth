import { Channel, invoke } from '@tauri-apps/api/core'
import type { PermissionMode, PiEvent, RuntimeSnapshot, ToolLogPage } from '@/lib/generated/pi'

let activeChannel: Channel<PiEvent> | null = null
let connection = 0

export async function connectPi(
  projectPath: string | null,
  onSnapshot: (snapshot: RuntimeSnapshot) => void,
  onEvent: (event: PiEvent) => void,
  sessionPath?: string | null,
) {
  const request = ++connection
  activeChannel = null
  const channel = new Channel<PiEvent>()
  const pending: PiEvent[] = []
  let subscribed = false
  channel.onmessage = (event) => {
    if (request !== connection) return
    if (subscribed) onEvent(event)
    else pending.push(event)
  }
  const snapshot = await invoke<RuntimeSnapshot>('pi_open', {
    projectPath,
    sessionPath: sessionPath ?? null,
    onEvent: channel,
  })
  if (request !== connection) return
  activeChannel = channel
  onSnapshot(snapshot)
  subscribed = true
  for (const event of pending) if (event.sequence > snapshot.sequence) onEvent(event)
}

export function sendPiMessage(
  instanceId: string,
  runId: string,
  message: string,
  attachmentIds: string[] = [],
) {
  return invoke<void>('pi_send', { instanceId, runId, message, attachmentIds })
}

export function stopPi(instanceId: string) {
  return invoke<void>('pi_stop', { instanceId })
}

export function rewritePiMessage(
  instanceId: string,
  runId: string,
  messageId: string,
  message?: string,
) {
  return invoke<void>('pi_rewrite', { instanceId, runId, messageId, message: message ?? null })
}

export function decidePiTool(instanceId: string, approvalId: string, allow: boolean) {
  return invoke<void>('pi_tool_decide', { instanceId, approvalId, allow })
}

export function loadPiToolOutput(
  instanceId: string,
  toolId: string,
  section: 'arguments' | 'output',
  offset = 0,
) {
  return invoke<ToolLogPage>('pi_tool_output', { instanceId, toolId, section, offset })
}

export function setPiModel(instanceId: string, provider: string, modelId: string) {
  if (!activeChannel) throw new Error('请先连接 Pi。')
  return invoke<RuntimeSnapshot>('pi_set_model', {
    instanceId,
    provider,
    modelId,
  })
}

export function setPiThinkingLevel(instanceId: string, level: string) {
  if (!activeChannel) throw new Error('请先连接 Pi。')
  return invoke<RuntimeSnapshot>('pi_set_thinking_level', { instanceId, level })
}

export async function disconnectPi() {
  connection++
  activeChannel = null
  await invoke<void>('pi_disconnect')
}

export function setPiPermission(instanceId: string, mode: PermissionMode) {
  if (!activeChannel) throw new Error('请先连接 Pi。')
  return invoke<RuntimeSnapshot>('pi_set_permission', { instanceId, mode })
}
