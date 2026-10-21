import { beforeEach, expect, test, vi } from 'vitest'
import { Channel, invoke } from '@tauri-apps/api/core'
import { connectPi, disconnectPi, sendPiMessage, setPiModel } from './pi'
import type { PiEvent, RuntimeSnapshot } from './generated/pi'

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: vi.fn(),
}))

type WireMessage = { index: number; end?: true; message?: PiEvent }
let callbacks: Map<number, (message: WireMessage) => void>
let nextId = 0
const snapshot: RuntimeSnapshot = {
  instanceId: 'pi-1',
  projectPath: 'project',
  sessionId: 'session-1',
  sessionFile: null,
  readOnly: null,
  model: null,
  models: [],
  messages: [],
  tools: [],
  timeline: [],
  activeRunId: null,
  sequence: 0,
}
const event: PiEvent = {
  instanceId: 'pi-1',
  projectPath: 'project',
  sessionId: 'session-1',
  runId: 'run-1',
  sequence: 1,
  data: {
    type: 'message_delta',
    messageId: 'assistant-1',
    contentIndex: 0,
    kind: 'text',
    delta: '你好',
  },
}

beforeEach(async () => {
  vi.mocked(invoke).mockResolvedValue(undefined)
  await disconnectPi()
  vi.mocked(invoke).mockReset()
  callbacks = new Map()
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {
      transformCallback: (callback: (message: WireMessage) => void) => {
        const id = ++nextId
        callbacks.set(id, callback)
        return id
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
    },
  })
})

test('model changes keep the original Tauri stream alive', async () => {
  let channel: Channel<PiEvent>
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const input = args as Record<string, unknown>
    if (command === 'pi_open') {
      channel = input.onEvent as Channel<PiEvent>
      return snapshot
    }
    if (command === 'pi_set_model') {
      // Tauri drops the old Rust channel if a command replaces its subscription.
      // Its end marker unregisters this JS callback, even if its ID is reused.
      if (input.onEvent) callbacks.get(channel.id)?.({ end: true, index: 0 })
      return { ...snapshot, model: { provider: 'test', id: 'other', name: 'Other' } }
    }
    if (command === 'pi_send') callbacks.get(channel.id)?.({ index: 0, message: event })
    return undefined
  })
  const received = vi.fn()
  await connectPi('project', () => {}, received)
  await setPiModel('pi-1', 'test', 'other')
  await sendPiMessage('pi-1', 'run-1', 'hello')
  expect(received).toHaveBeenCalledWith(event)
})

test('events arriving before the snapshot are replayed once, after hydration', async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const channel = (args as { onEvent: Channel<PiEvent> }).onEvent
    callbacks.get(channel.id)?.({ index: 0, message: event })
    callbacks.get(channel.id)?.({ index: 1, message: { ...event, sequence: 2 } })
    return { ...snapshot, sequence: 1 }
  })
  const order: string[] = []
  await connectPi(
    'project',
    () => order.push('snapshot'),
    (event) => order.push(`event-${event.sequence}`),
  )
  expect(order).toEqual(['snapshot', 'event-2'])
})

test('a late snapshot and stream from an older connection cannot replace the current session', async () => {
  let finishOld!: (snapshot: RuntimeSnapshot) => void
  let oldChannel!: Channel<PiEvent>
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const input = args as { sessionPath: string; onEvent: Channel<PiEvent> }
    if (input.sessionPath === 'old') {
      oldChannel = input.onEvent
      return new Promise<RuntimeSnapshot>((resolve) => {
        finishOld = resolve
      })
    }
    return { ...snapshot, instanceId: 'new' }
  })
  const hydrated = vi.fn()
  const received = vi.fn()
  const old = connectPi('project', hydrated, received, 'old')
  await connectPi('project', hydrated, received, 'new')
  finishOld(snapshot)
  await old
  callbacks.get(oldChannel.id)?.({ index: 0, message: event })
  expect(hydrated).toHaveBeenCalledOnce()
  expect(hydrated.mock.calls[0][0].instanceId).toBe('new')
  expect(received).not.toHaveBeenCalled()
})
