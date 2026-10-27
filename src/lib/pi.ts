import { Channel, invoke } from '@tauri-apps/api/core'
import type {
  NextTurnSettings,
  PermissionMode,
  PiEvent,
  RuntimeSnapshot,
  ToolLogPage,
} from '@/lib/generated/pi'

let activeChannel: Channel<PiEvent> | null = null
const channels = new Map<string, { channel: Channel<PiEvent>; running: boolean; queued: number }>()
let connection = 0
const settingsUpdates = new Map<string, Promise<void>>()

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
  let instanceId: string | null = null
  const deliver = (event: PiEvent) => {
    const subscription = instanceId ? channels.get(instanceId) : undefined
    if (subscription?.channel !== channel || event.instanceId !== instanceId) return
    if (event.data.type === 'run_started') subscription.running = true
    if (event.data.type === 'run_finished') subscription.running = false
    if (event.data.type === 'queue_changed') subscription.queued = event.data.messages.length
    onEvent(event)
    if (event.data.type === 'disconnected' && instanceId) channels.delete(instanceId)
  }
  channel.onmessage = (event) => {
    if (!subscribed && request !== connection && channels.has(event.instanceId)) {
      instanceId = event.instanceId
      channels.set(instanceId, { channel, running: Boolean(event.runId), queued: 0 })
      subscribed = true
      for (const previous of pending.splice(0)) deliver(previous)
    }
    if (subscribed) deliver(event)
    else if (request !== connection) return
    else pending.push(event)
  }
  const snapshot = await invoke<RuntimeSnapshot>('pi_open', {
    projectPath,
    sessionPath: sessionPath ?? null,
    onEvent: channel,
  })
  if (request !== connection) {
    // Re-subscribing a busy resident replaces its old native channel even if
    // navigation was superseded. Keep those events routed to its background state.
    if (subscribed || !channels.has(snapshot.instanceId)) return
    instanceId = snapshot.instanceId
    channels.set(instanceId, {
      channel,
      running: Boolean(snapshot.activeRunId),
      queued: snapshot.queuedMessages?.length ?? 0,
    })
    subscribed = true
    for (const event of pending) deliver(event)
    return
  }
  instanceId = snapshot.instanceId
  channels.set(instanceId, {
    channel,
    running: Boolean(snapshot.activeRunId),
    queued: snapshot.queuedMessages?.length ?? 0,
  })
  // The native pool contains at most three runtimes. Never discard a running
  // channel just because another conversation became the visible one.
  for (const [id, subscription] of channels) {
    if (channels.size <= 3) break
    if (id !== instanceId && !subscription.running && !subscription.queued) channels.delete(id)
  }
  activeChannel = channel
  onSnapshot(snapshot)
  subscribed = true
  for (const event of pending) {
    if (event.sequence <= snapshot.sequence) continue
    deliver(event)
  }
}

export function sendPiMessage(
  instanceId: string,
  runId: string,
  message: string,
  attachmentIds: string[] = [],
) {
  const send = () =>
    invoke<PiEvent | void>('pi_send', { instanceId, runId, message, attachmentIds })
  return settingsUpdates.get(instanceId)?.then(send) ?? send()
}

export function updatePiNextSettings(
  instanceId: string,
  settings: NextTurnSettings,
  preferredThinkingLevel: string | null = null,
) {
  const previous = settingsUpdates.get(instanceId) ?? Promise.resolve()
  const operation = previous.then(() =>
    invoke<PiEvent>('pi_update_next_settings', { instanceId, settings, preferredThinkingLevel }),
  )
  const settled = operation.then(
    () => {},
    () => {},
  )
  settingsUpdates.set(instanceId, settled)
  void settled.then(() => {
    if (settingsUpdates.get(instanceId) === settled) settingsUpdates.delete(instanceId)
  })
  return operation
}

export function stopPi(instanceId: string) {
  return invoke<void>('pi_stop', { instanceId })
}

export function removeQueuedPiMessage(instanceId: string, messageId: string) {
  return invoke<void>('pi_remove_queued_message', { instanceId, messageId })
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
  channels.clear()
  await invoke<void>('pi_disconnect')
}

export function setPiPermission(instanceId: string, mode: PermissionMode) {
  if (!activeChannel) throw new Error('请先连接 Pi。')
  return invoke<RuntimeSnapshot>('pi_set_permission', { instanceId, mode })
}
