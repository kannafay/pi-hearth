import { beforeEach, expect, test, vi } from 'vitest'
import {
  emptyConversation,
  reducePiEvent,
  useConversationStore,
  type ConversationData,
} from './store'
import type { ChatMessage, EventData, PiEvent, RuntimeSnapshot, ToolCall } from '@/lib/generated/pi'
import {
  connectPi,
  sendPiMessage,
  rewritePiMessage,
  setPiModel,
  setPiPermission,
  setPiThinkingLevel,
  stopPi,
} from '@/lib/pi'
import { loadThinkingPreference, saveThinkingPreference } from './thinking-preference'
import { rememberSession, sessionDisplay } from './session-cache'

vi.mock('@/lib/pi', () => ({
  connectPi: vi.fn(),
  disconnectPi: vi.fn(),
  sendPiMessage: vi.fn(),
  rewritePiMessage: vi.fn(),
  stopPi: vi.fn(),
  setPiModel: vi.fn(),
  setPiPermission: vi.fn(),
  setPiThinkingLevel: vi.fn(),
}))

const message: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  text: '',
  thinking: '',
  status: 'streaming',
  error: null,
}
const snapshot: RuntimeSnapshot = {
  queuedMessages: [],
  instanceId: 'pi-1',
  permissionMode: 'ask',
  projectPath: 'project',
  sessionId: 'session-1',
  sessionFile: null,
  readOnly: null,
  model: { provider: 'test', id: 'chat', name: 'Chat' },
  models: [],
  thinkingLevel: 'medium',
  availableThinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  messages: [],
  tools: [],
  timeline: [],
  activeRunId: null,
  sequence: 0,
}
function event(
  sequence: number,
  data: EventData,
  instanceId = 'pi-1',
  runId: string | null = 'run-1',
): PiEvent {
  return { instanceId, projectPath: 'project', sessionId: 'session-1', runId, sequence, data }
}

beforeEach(() => {
  localStorage.clear()
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  vi.clearAllMocks()
  useConversationStore.setState({ availableThinkingLevels: snapshot.availableThinkingLevels })
  vi.mocked(setPiThinkingLevel).mockResolvedValue(snapshot)
  vi.mocked(setPiModel).mockResolvedValue(snapshot)
  vi.mocked(setPiPermission).mockImplementation(async (_id, mode) => ({
    ...snapshot,
    permissionMode: mode,
  }))
})

test('context usage follows runtime snapshots and events and never leaks into a new session', async () => {
  const usage = { tokens: 12000, contextWindow: 200000, percent: 6 }
  vi.mocked(setPiThinkingLevel).mockResolvedValue({ ...snapshot, contextUsage: usage })
  vi.mocked(connectPi).mockImplementation(async (_path, hydrate) => {
    hydrate({ ...snapshot, contextUsage: usage })
  })
  await useConversationStore.getState().connect('project', 'current.jsonl', { force: true })
  let state = useConversationStore.getState()
  expect(state.contextUsage).toEqual(usage)
  expect(sessionDisplay(state).contextUsage).toEqual(usage)
  const cache = rememberSession(new Map(), state)
  expect(cache.get('id:session-1')?.display.contextUsage).toEqual(usage)

  const compacted = { tokens: null, contextWindow: 200000, percent: null }
  state.receive([event(1, { type: 'context_usage_changed', usage: compacted }, 'pi-1', null)])
  state = useConversationStore.getState()
  expect(state.contextUsage).toEqual(compacted)
  state.receive([event(0, { type: 'context_usage_changed', usage }, 'pi-1', null)])
  state.receive([event(2, { type: 'context_usage_changed', usage }, 'old-runtime', null)])
  expect(useConversationStore.getState().contextUsage).toEqual(compacted)

  vi.mocked(connectPi).mockImplementation(async (_path, hydrate) => {
    hydrate({ ...snapshot, instanceId: 'pi-2', sessionId: 'session-2' })
  })
  vi.mocked(setPiThinkingLevel).mockResolvedValue({ ...snapshot, instanceId: 'pi-2' })
  await state.connect('project', 'next.jsonl')
  expect(useConversationStore.getState().contextUsage).toBeNull()
})

test('permission-only changes serialize the last choice without touching model or thinking settings', async () => {
  useConversationStore.setState({ ...snapshot, status: 'ready' })
  const first = deferred<RuntimeSnapshot>()
  vi.mocked(setPiPermission).mockReturnValueOnce(first.promise)
  const changes = [
    useConversationStore.getState().changePermission('auto'),
    useConversationStore.getState().changePermission('ask'),
    useConversationStore.getState().changePermission('full'),
  ]
  expect(setPiPermission).toHaveBeenCalledExactlyOnceWith('pi-1', 'auto')
  expect(await useConversationStore.getState().send('wait')).toBe(false)
  first.resolve({ ...snapshot, permissionMode: 'auto' })
  await Promise.all(changes)
  expect(vi.mocked(setPiPermission).mock.calls).toEqual([
    ['pi-1', 'auto'],
    ['pi-1', 'full'],
  ])
  expect(useConversationStore.getState()).toMatchObject({
    permissionMode: 'full',
    pendingSettings: null,
    settingsPending: null,
  })
  expect(setPiModel).not.toHaveBeenCalled()
  expect(setPiThinkingLevel).not.toHaveBeenCalled()
  expect(loadThinkingPreference()).toBe('default')
})

test('new-chat permissions display the configured default and connecting choices supersede it on readiness', async () => {
  const opening = deferred<void>()
  let hydrate!: (value: RuntimeSnapshot) => void
  vi.mocked(connectPi).mockImplementationOnce((_project, receive) => {
    hydrate = receive
    return opening.promise
  })
  const pending = useConversationStore
    .getState()
    .connect('project', undefined, { defaultPermission: 'full' })
  expect(useConversationStore.getState().permissionMode).toBe('full')
  await useConversationStore.getState().changePermission('ask')
  await useConversationStore.getState().changePermission('auto')
  expect(setPiPermission).not.toHaveBeenCalled()
  vi.mocked(setPiThinkingLevel).mockResolvedValueOnce({ ...snapshot, permissionMode: 'auto' })
  hydrate({ ...snapshot, permissionMode: 'full' })
  opening.resolve()
  await pending
  expect(setPiPermission).toHaveBeenCalledExactlyOnceWith('pi-1', 'auto')
  expect(setPiThinkingLevel).toHaveBeenCalledExactlyOnceWith('pi-1', 'default')
  expect(useConversationStore.getState().permissionMode).toBe('auto')
})

test('a late permission acknowledgement cannot overwrite another session or its cached permissions', async () => {
  useConversationStore.setState({
    ...sessionSnapshot('A'),
    permissionMode: 'auto',
    status: 'ready',
  })
  const applying = deferred<RuntimeSnapshot>()
  vi.mocked(setPiPermission).mockReturnValueOnce(applying.promise)
  const changing = useConversationStore.getState().changePermission('full')
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) =>
    hydrate(sessionSnapshot('B')),
  )
  vi.mocked(setPiThinkingLevel).mockResolvedValueOnce(sessionSnapshot('B'))
  await useConversationStore.getState().connect('project', 'B')
  applying.resolve({ ...sessionSnapshot('A'), permissionMode: 'full' })
  await changing
  expect(useConversationStore.getState()).toMatchObject({
    sessionId: 'B',
    permissionMode: 'ask',
    pendingSettings: null,
  })
  vi.mocked(connectPi).mockImplementationOnce(async () => {})
  await useConversationStore.getState().connect('project', 'A')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'connecting',
    permissionMode: 'auto',
    instanceId: null,
  })
})

test('failed permission writes retain the acknowledged mode and read-only sessions cannot change it', async () => {
  useConversationStore.setState({ ...snapshot, status: 'ready' })
  vi.mocked(setPiPermission).mockRejectedValueOnce(new Error('write failed'))
  await useConversationStore.getState().changePermission('full')
  expect(useConversationStore.getState()).toMatchObject({
    permissionMode: 'ask',
    pendingSettings: null,
    error: 'Error: write failed',
  })
  useConversationStore.setState({ readOnly: 'missing directory' })
  await useConversationStore.getState().changePermission('auto')
  expect(setPiPermission).toHaveBeenCalledTimes(1)
})

test.each(['running', 'stopping'] as const)(
  '%s replies retain their settings while the latest model, effort and permission choices wait for completion',
  async (status) => {
    const nextModel = { provider: 'next', id: 'model', name: 'Next' }
    useConversationStore.setState({ ...snapshot, status, activeRunId: 'run-1' })
    await useConversationStore.getState().changeModel({ ...nextModel, id: 'superseded' })
    await useConversationStore.getState().changePermission('full')
    await useConversationStore.getState().changeModel(nextModel)
    await useConversationStore.getState().changeThinkingLevel('high')
    await useConversationStore.getState().changePermission('auto')
    expect(useConversationStore.getState()).toMatchObject({
      status,
      model: snapshot.model,
      permissionMode: 'ask',
      thinkingLevel: 'medium',
      settingsPending: null,
      pendingSettings: { model: nextModel, permissionMode: 'auto', thinkingLevel: 'high' },
    })
    expect(setPiModel).not.toHaveBeenCalled()
    expect(setPiPermission).not.toHaveBeenCalled()
    expect(setPiThinkingLevel).not.toHaveBeenCalled()

    const permission = deferred<RuntimeSnapshot>()
    vi.mocked(setPiPermission).mockReturnValueOnce(permission.promise)
    vi.mocked(setPiModel).mockResolvedValue({
      ...snapshot,
      model: nextModel,
      permissionMode: 'auto',
    })
    vi.mocked(setPiThinkingLevel).mockResolvedValue({
      ...snapshot,
      model: nextModel,
      permissionMode: 'auto',
      thinkingLevel: 'high',
    })
    useConversationStore
      .getState()
      .receive([event(1, { type: 'run_finished', status: 'complete', error: null })])
    expect(setPiPermission).toHaveBeenCalledExactlyOnceWith('pi-1', 'auto')
    expect(await useConversationStore.getState().send('too early')).toBe(false)
    permission.resolve({ ...snapshot, permissionMode: 'auto' })
    await vi.waitFor(() => expect(useConversationStore.getState().pendingSettings).toBeNull())
    expect(setPiModel).toHaveBeenCalledExactlyOnceWith('pi-1', nextModel.provider, nextModel.id)
    expect(setPiThinkingLevel).toHaveBeenCalledExactlyOnceWith('pi-1', 'high')
    vi.mocked(sendPiMessage).mockResolvedValue()
    expect(await useConversationStore.getState().send('next turn')).toBe(true)
    expect(useConversationStore.getState()).toMatchObject({
      model: nextModel,
      permissionMode: 'auto',
      thinkingLevel: 'high',
    })
  },
)

test('queued choices are applied even if the send fails before a terminal event arrives', async () => {
  useConversationStore.setState({ ...snapshot, status: 'ready' })
  const prompt = deferred<void>()
  vi.mocked(sendPiMessage).mockReturnValueOnce(prompt.promise)
  const sending = useConversationStore.getState().send('start')
  await useConversationStore.getState().changePermission('auto')
  expect(setPiPermission).not.toHaveBeenCalled()
  prompt.reject(new Error('request failed'))
  expect(await sending).toBe(false)
  await vi.waitFor(() => expect(useConversationStore.getState().pendingSettings).toBeNull())
  expect(setPiPermission).toHaveBeenCalledExactlyOnceWith('pi-1', 'auto')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'ready',
    permissionMode: 'auto',
    settingsPending: null,
  })
})

test('rewrites retain the current transcript until the authoritative branch event and prevent duplicate sends', async () => {
  const prompt = {
    ...message,
    id: 'original-prompt',
    role: 'user',
    text: 'old',
    status: 'complete',
  }
  const original = [
    prompt,
    { ...message, id: 'old-answer', text: 'old answer', status: 'complete' },
  ]
  useConversationStore.setState({ instanceId: 'pi-1', status: 'ready', messages: original })
  let finish!: () => void
  vi.mocked(rewritePiMessage).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const request = useConversationStore.getState().rewrite(prompt.id, 'new')
  const run = useConversationStore.getState().activeRunId
  expect(useConversationStore.getState().messages).toBe(original)
  expect(await useConversationStore.getState().send('duplicate')).toBe(false)
  expect(await useConversationStore.getState().rewrite(prompt.id)).toBe(false)
  expect(rewritePiMessage).toHaveBeenCalledWith('pi-1', run, prompt.id, 'new')
  useConversationStore
    .getState()
    .receive([
      event(
        1,
        { type: 'transcript_replaced', messages: [], tools: [], timeline: [] },
        'pi-1',
        null,
      ),
    ])
  expect(useConversationStore.getState()).toMatchObject({
    status: 'running',
    activeRunId: run,
    messages: [],
    timeline: [],
    blocks: {},
  })
  finish()
  expect(await request).toBe(true)
})

test('failed message actions keep history and cannot change read-only sessions', async () => {
  const prompt = {
    ...message,
    id: 'original-prompt',
    role: 'user',
    text: 'old',
    status: 'complete',
  }
  const messages = [prompt]
  useConversationStore.setState({ instanceId: 'pi-1', status: 'ready', messages })
  vi.mocked(rewritePiMessage).mockRejectedValueOnce(new Error('record changed'))
  expect(await useConversationStore.getState().rewrite(prompt.id)).toBe(false)
  expect(useConversationStore.getState()).toMatchObject({
    status: 'ready',
    messages,
    error: 'Error: record changed',
  })
  useConversationStore.setState({ readOnly: 'missing directory' })
  expect(await useConversationStore.getState().rewrite(prompt.id)).toBe(false)
  expect(rewritePiMessage).toHaveBeenCalledTimes(1)
})

test('switching during connection ignores the old failure and hydrates the latest target', async () => {
  let failOld!: (reason: Error) => void
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    if (file === 'old')
      return new Promise<void>((_resolve, reject) => {
        failOld = reject
      })
    hydrate({ ...snapshot, instanceId: 'new', sessionFile: file ?? null })
  })
  const old = useConversationStore.getState().connect('project', 'old')
  await useConversationStore.getState().connect('project', 'new')
  failOld(new Error('old connection failed'))
  await old
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'new',
    sessionFile: 'new',
    status: 'ready',
    error: null,
  })
})

function sessionSnapshot(file: string, text = `回复 ${file}`): RuntimeSnapshot {
  return {
    ...snapshot,
    instanceId: `pi-${file}`,
    sessionId: file,
    sessionFile: file,
    messages: [{ ...message, id: `${file}-answer`, text, status: 'complete' }],
    timeline: [{ kind: 'message', id: `${file}-answer` }],
    sequence: 42,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

test('an uncached session keeps the model catalog and applies only the final choices after hydration', async () => {
  const first = snapshot.model!
  const second = { provider: 'other', id: 'chat', name: 'Other Chat' }
  const models = [first, second]
  useConversationStore.setState({ instanceId: 'old', status: 'ready', models })
  const opening = deferred<void>()
  let hydrate!: (value: RuntimeSnapshot) => void
  vi.mocked(connectPi).mockImplementation((_project, onSnapshot) => {
    hydrate = onSnapshot
    return opening.promise
  })
  const final = { ...sessionSnapshot('new'), model: second, models, thinkingLevel: 'max' }
  vi.mocked(setPiModel).mockResolvedValue({ ...final, thinkingLevel: 'medium' })
  vi.mocked(setPiThinkingLevel).mockResolvedValue(final)
  const pending = useConversationStore.getState().connect('project', 'new')
  expect(useConversationStore.getState().models).toBe(models)
  await useConversationStore.getState().changeModel(first)
  await useConversationStore.getState().changeThinkingLevel('low')
  await useConversationStore.getState().changeModel(second)
  await useConversationStore.getState().changeThinkingLevel('max')
  expect(setPiModel).not.toHaveBeenCalled()
  expect(setPiThinkingLevel).not.toHaveBeenCalled()
  expect(loadThinkingPreference()).toBe('default')
  hydrate({ ...sessionSnapshot('new'), models })
  opening.resolve()
  await pending
  expect(setPiModel).toHaveBeenCalledExactlyOnceWith('pi-new', 'other', 'chat')
  expect(setPiThinkingLevel).toHaveBeenCalledExactlyOnceWith('pi-new', 'max')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'ready',
    model: second,
    requestedThinkingLevel: 'max',
    thinkingLevel: 'max',
    pendingSettings: null,
    settingsPending: null,
  })
  expect(loadThinkingPreference()).toBe('max')
})

test('cached transcript hydration keeps the choices made while reopening that session', async () => {
  const selected = { provider: 'p', id: 'selected', name: 'Selected' }
  const models = [snapshot.model!, selected]
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate({ ...sessionSnapshot(file!), models })
  })
  vi.mocked(setPiThinkingLevel).mockImplementation(async (instanceId) => ({
    ...snapshot,
    instanceId,
    models,
  }))
  await useConversationStore.getState().connect('project', 'A')
  await useConversationStore.getState().connect('project', 'B')
  const opening = deferred<void>()
  let hydrate!: (value: RuntimeSnapshot) => void
  vi.mocked(connectPi).mockImplementationOnce((_project, onSnapshot) => {
    hydrate = onSnapshot
    return opening.promise
  })
  vi.mocked(setPiModel).mockClear()
  vi.mocked(setPiModel).mockResolvedValue({ ...sessionSnapshot('A'), models, model: selected })
  const applying = deferred<RuntimeSnapshot>()
  vi.mocked(setPiThinkingLevel).mockClear()
  vi.mocked(setPiThinkingLevel).mockReturnValueOnce(applying.promise)
  const returning = useConversationStore.getState().connect('project', 'A')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'connecting',
    messages: [{ text: '回复 A' }],
    instanceId: null,
  })
  await useConversationStore.getState().changeModel(selected)
  await useConversationStore.getState().changeThinkingLevel('high')
  hydrate({ ...sessionSnapshot('A', '同步后的回复 A'), models })
  opening.resolve()
  await vi.waitFor(() => expect(setPiThinkingLevel).toHaveBeenCalledExactlyOnceWith('pi-A', 'high'))
  expect(useConversationStore.getState()).toMatchObject({
    messages: [{ text: '同步后的回复 A' }],
    pendingSettings: { model: selected, thinkingLevel: 'high' },
  })
  applying.resolve({ ...sessionSnapshot('A'), model: selected, models, thinkingLevel: 'high' })
  await returning
  expect(setPiModel).toHaveBeenCalledExactlyOnceWith('pi-A', 'p', 'selected')
  expect(useConversationStore.getState()).toMatchObject({
    model: selected,
    requestedThinkingLevel: 'high',
    pendingSettings: null,
    messages: [{ text: '同步后的回复 A' }],
  })
})

test('new choices during automatic effort restoration supersede its acknowledgement and remain unsendable until applied', async () => {
  const intermediate = { provider: 'p', id: 'intermediate', name: 'Intermediate' }
  const last = { provider: 'p', id: 'last', name: 'Last' }
  const restoring = deferred<RuntimeSnapshot>()
  const applying = deferred<RuntimeSnapshot>()
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate) => hydrate(snapshot))
  vi.mocked(setPiThinkingLevel)
    .mockReturnValueOnce(restoring.promise)
    .mockReturnValueOnce(applying.promise)
  vi.mocked(setPiModel).mockResolvedValue({ ...snapshot, model: last })
  const pending = useConversationStore.getState().connect('project')
  expect(setPiThinkingLevel).toHaveBeenCalledExactlyOnceWith('pi-1', 'default')
  const changes = [
    useConversationStore.getState().changeModel(intermediate),
    useConversationStore.getState().changeThinkingLevel('low'),
    useConversationStore.getState().changeModel(last),
    useConversationStore.getState().changeThinkingLevel('max'),
  ]
  restoring.resolve({ ...snapshot, thinkingLevel: 'off' })
  await vi.waitFor(() => expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-1', 'max'))
  expect(setPiModel).toHaveBeenCalledExactlyOnceWith('pi-1', 'p', 'last')
  expect(useConversationStore.getState().pendingSettings).toEqual({
    model: last,
    thinkingLevel: 'max',
  })
  expect(await useConversationStore.getState().send('wait')).toBe(false)
  expect(loadThinkingPreference()).toBe('default')
  applying.resolve({ ...snapshot, model: last, thinkingLevel: 'max' })
  await Promise.all([pending, ...changes])
  expect(loadThinkingPreference()).toBe('max')
  expect(await useConversationStore.getState().send('ready')).toBe(true)
  expect(sendPiMessage).toHaveBeenCalledExactlyOnceWith('pi-1', expect.any(String), 'ready', [])
})

test('an in-flight model change drains the latest model and effort without parallel requests or stale fallback', async () => {
  const first = { provider: 'p', id: 'first', name: 'First' }
  const intermediate = { provider: 'p', id: 'skip', name: 'Skip' }
  const last = { provider: 'p', id: 'last', name: 'Last' }
  useConversationStore.setState({ instanceId: 'pi-1', status: 'ready', model: snapshot.model })
  const applying = deferred<RuntimeSnapshot>()
  vi.mocked(setPiModel)
    .mockReturnValueOnce(applying.promise)
    .mockResolvedValue({ ...snapshot, model: last })
  vi.mocked(setPiThinkingLevel).mockResolvedValue({
    ...snapshot,
    model: last,
    thinkingLevel: 'max',
  })
  const changes = [
    useConversationStore.getState().changeModel(first),
    useConversationStore.getState().changeModel(intermediate),
    useConversationStore.getState().changeThinkingLevel('low'),
    useConversationStore.getState().changeModel(last),
    useConversationStore.getState().changeThinkingLevel('max'),
  ]
  expect(setPiModel).toHaveBeenCalledTimes(1)
  expect(setPiThinkingLevel).not.toHaveBeenCalled()
  applying.resolve({ ...snapshot, model: first, availableThinkingLevels: ['off'] })
  await Promise.all(changes)
  expect(vi.mocked(setPiModel).mock.calls).toEqual([
    ['pi-1', 'p', 'first'],
    ['pi-1', 'p', 'last'],
  ])
  expect(setPiThinkingLevel).toHaveBeenCalledExactlyOnceWith('pi-1', 'max')
  expect(useConversationStore.getState()).toMatchObject({
    model: last,
    requestedThinkingLevel: 'max',
    pendingSettings: null,
  })
})

test('switching targets discards queued choices and ignores late hydration and setting results', async () => {
  const discarded = { provider: 'p', id: 'discarded', name: 'Discarded' }
  const chosen = { provider: 'p', id: 'chosen', name: 'Chosen' }
  const old = deferred<void>()
  let hydrateOld!: (value: RuntimeSnapshot) => void
  vi.mocked(connectPi)
    .mockImplementationOnce((_project, hydrate) => {
      hydrateOld = hydrate
      return old.promise
    })
    .mockImplementationOnce(async (_project, hydrate) => hydrate(sessionSnapshot('B')))
  const pending = useConversationStore.getState().connect('project', 'A')
  await useConversationStore.getState().changeModel(discarded)
  await useConversationStore.getState().changeThinkingLevel('max')
  const restoring = deferred<RuntimeSnapshot>()
  vi.mocked(setPiThinkingLevel).mockReturnValueOnce(restoring.promise)
  const latest = useConversationStore.getState().connect('project', 'B')
  expect(useConversationStore.getState().pendingSettings).toEqual({
    model: null,
    thinkingLevel: 'default',
  })
  hydrateOld(sessionSnapshot('A'))
  old.resolve()
  await pending
  expect(useConversationStore.getState().instanceId).toBe('pi-B')
  const changing = useConversationStore.getState().changeModel(chosen)
  vi.mocked(setPiModel).mockResolvedValue({ ...sessionSnapshot('B'), model: chosen })
  vi.mocked(setPiThinkingLevel).mockResolvedValue({
    ...sessionSnapshot('B'),
    model: chosen,
    thinkingLevel: 'high',
  })
  const thinking = useConversationStore.getState().changeThinkingLevel('high')
  restoring.resolve(sessionSnapshot('B'))
  await Promise.all([latest, changing, thinking])
  expect(setPiModel).toHaveBeenCalledExactlyOnceWith('pi-B', 'p', 'chosen')
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'pi-B',
    model: chosen,
    requestedThinkingLevel: 'high',
  })
})

test('unsupported queued efforts use the new model default and read-only snapshots discard queued settings', async () => {
  const model = { provider: 'p', id: 'limited', name: 'Limited' }
  const opening = deferred<void>()
  let hydrate!: (value: RuntimeSnapshot) => void
  vi.mocked(connectPi).mockImplementation((_project, onSnapshot) => {
    hydrate = onSnapshot
    return opening.promise
  })
  vi.mocked(setPiModel).mockResolvedValue({
    ...snapshot,
    model,
    availableThinkingLevels: ['off', 'high'],
  })
  vi.mocked(setPiThinkingLevel).mockResolvedValue({ ...snapshot, model, thinkingLevel: 'high' })
  const pending = useConversationStore.getState().connect('project', 'A')
  await useConversationStore.getState().changeModel(model)
  await useConversationStore.getState().changeThinkingLevel('max')
  hydrate(sessionSnapshot('A'))
  opening.resolve()
  await pending
  expect(setPiThinkingLevel).toHaveBeenCalledExactlyOnceWith('pi-A', 'default')
  expect(useConversationStore.getState().requestedThinkingLevel).toBe('default')
  const readOnly = useConversationStore.getState().connect('missing', 'B')
  await useConversationStore.getState().changeModel(model)
  await useConversationStore.getState().changeThinkingLevel('max')
  hydrate({ ...sessionSnapshot('B'), readOnly: '文件夹不存在' })
  await readOnly
  expect(setPiModel).toHaveBeenCalledTimes(1)
  expect(useConversationStore.getState()).toMatchObject({
    readOnly: '文件夹不存在',
    pendingSettings: null,
    settingsPending: null,
  })
})

test('returning to a cached session displays the latest reply immediately and waits for a fresh runtime before sending', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file!))
  })
  await useConversationStore.getState().connect('project', 'D:\\history\\A.jsonl')
  useConversationStore.setState({
    messages: [{ ...message, text: '刚完成的新回复', status: 'complete' }],
    lastLocalActivityAt: 3000,
  })
  await useConversationStore.getState().connect('project', 'B')
  let hydrate!: (snapshot: RuntimeSnapshot) => void
  let finish!: () => void
  vi.mocked(connectPi).mockImplementation((_project, onSnapshot) => {
    hydrate = onSnapshot
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const pending = useConversationStore.getState().connect('project', 'd:/history/a.jsonl')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'connecting',
    instanceId: null,
    activeRunId: null,
    sequence: 0,
    blocks: {},
    lastLocalActivityAt: 3000,
    model: snapshot.model,
    messages: [{ text: '刚完成的新回复' }],
  })
  expect(await useConversationStore.getState().send('暂时不能发送')).toBe(false)
  expect(sendPiMessage).not.toHaveBeenCalled()
  vi.spyOn(Date, 'now').mockReturnValue(4000)
  hydrate(sessionSnapshot('d:/history/a.jsonl', '后台同步后的最新内容'))
  finish()
  await pending
  expect(useConversationStore.getState()).toMatchObject({
    status: 'ready',
    instanceId: 'pi-d:/history/a.jsonl',
    lastLocalActivityAt: 4000,
    messages: [{ text: '后台同步后的最新内容' }],
  })
})

test('native session IDs reuse aliased history and bind cached message and tool actions to the new runtime', async () => {
  const prompt = { ...message, id: 'old-user', role: 'user', text: '问题', status: 'complete' }
  const answer = { ...message, id: 'old-answer', text: '回答', status: 'complete' }
  const tool: ToolCall = {
    id: 'old-tool',
    toolCallId: 'native-call',
    runId: 'old-run',
    name: 'read',
    summary: 'file.txt',
    arguments: '{}',
    argumentsTruncated: false,
    output: '内容',
    outputTruncated: true,
    status: 'complete',
    approvalId: null,
    durationMs: 20,
  }
  const original: RuntimeSnapshot = {
    ...sessionSnapshot('logical.jsonl'),
    sessionId: 'native-A',
    messages: [prompt, answer],
    tools: [tool],
    timeline: [
      { kind: 'message', id: prompt.id },
      { kind: 'tool', id: tool.id },
      { kind: 'message', id: answer.id },
    ],
  }
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) => hydrate(original))
  await useConversationStore
    .getState()
    .connect('project', 'logical.jsonl', { sessionId: 'native-A' })
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) =>
    hydrate(sessionSnapshot('B')),
  )
  await useConversationStore.getState().connect('project', 'B', { sessionId: 'B' })

  const completed = deferred<void>()
  let hydrate!: (snapshot: RuntimeSnapshot) => void
  vi.mocked(connectPi).mockImplementationOnce((_project, onSnapshot) => {
    hydrate = onSnapshot
    return completed.promise
  })
  const reopening = useConversationStore
    .getState()
    .connect('project', 'canonical.jsonl', { sessionId: 'native-A' })
  const cached = useConversationStore.getState()
  expect(cached.status).toBe('connecting')
  expect(cached.messages[0]).toBe(prompt)
  expect(cached.tools[0]).toBe(tool)
  expect(cached.instanceId).toBeNull()
  expect(await cached.send('不能提前发送')).toBe(false)

  hydrate({
    ...original,
    instanceId: 'fresh-runtime',
    sessionFile: 'canonical.jsonl',
    sequence: 80,
    messages: original.messages.map((item) => ({
      ...item,
      id: `fresh-${item.id}`,
      timestamp: 9000,
    })),
    tools: [{ ...tool, id: 'fresh-tool', runId: 'fresh-run', durationMs: null }],
    timeline: [
      { kind: 'message', id: 'fresh-old-user' },
      { kind: 'tool', id: 'fresh-tool' },
      { kind: 'message', id: 'fresh-old-answer' },
    ],
  })
  completed.resolve()
  await reopening
  const ready = useConversationStore.getState()
  expect(ready.messages).toBe(cached.messages)
  expect(ready.tools).toBe(cached.tools)
  expect(ready.timeline).toBe(cached.timeline)
  expect(ready).toMatchObject({
    status: 'ready',
    instanceId: 'fresh-runtime',
    sequence: 80,
    runtimeMessageIds: { 'old-user': 'fresh-old-user', 'old-answer': 'fresh-old-answer' },
    runtimeToolIds: { 'old-tool': 'fresh-tool' },
  })
  expect(ready.sessionCache.get('id:native-A')?.paths).toEqual(['logical.jsonl', 'canonical.jsonl'])
  vi.mocked(rewritePiMessage).mockResolvedValueOnce()
  expect(await ready.rewrite(prompt.id, '修改')).toBe(true)
  expect(rewritePiMessage).toHaveBeenCalledWith(
    'fresh-runtime',
    expect.any(String),
    'fresh-old-user',
    '修改',
  )
  useConversationStore.getState().receive([
    event(
      81,
      {
        type: 'transcript_replaced',
        messages: [],
        tools: [],
        timeline: [],
      },
      'fresh-runtime',
      null,
    ),
  ])
  expect(useConversationStore.getState().runtimeMessageIds).toEqual({})
  expect(useConversationStore.getState().runtimeToolIds).toEqual({})
})

test('background hydration updates an externally changed reply while retaining the unchanged prompt', async () => {
  const prompt = { ...message, id: 'old-user', role: 'user', text: '问题', status: 'complete' }
  const original = {
    ...sessionSnapshot('A'),
    messages: [prompt, { ...message, id: 'old-answer', text: '旧回复', status: 'complete' }],
    timeline: [
      { kind: 'message', id: 'old-user' },
      { kind: 'message', id: 'old-answer' },
    ],
  }
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) => hydrate(original))
  await useConversationStore.getState().connect('project', 'A', { sessionId: 'A' })
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) =>
    hydrate({
      ...original,
      messages: [
        { ...prompt, id: 'new-user' },
        { ...message, id: 'new-answer', text: '外部更新', status: 'complete' },
      ],
      timeline: [
        { kind: 'message', id: 'new-user' },
        { kind: 'message', id: 'new-answer' },
      ],
    }),
  )
  await useConversationStore.getState().connect('project', 'A', { force: true, sessionId: 'A' })
  const state = useConversationStore.getState()
  expect(state.messages[0]).toBe(prompt)
  expect(state.messages[1].text).toBe('外部更新')
  expect(state.timeline).toEqual([
    { kind: 'message', id: 'old-user' },
    { kind: 'message', id: 'new-answer' },
  ])
  expect(state.runtimeMessageIds).toEqual({ 'old-user': 'new-user' })
})

test('a different native ID at the same path never revives the previous transcript', async () => {
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) =>
    hydrate({ ...sessionSnapshot('history.jsonl'), sessionId: 'old' }),
  )
  await useConversationStore.getState().connect('project', 'history.jsonl', { sessionId: 'old' })
  const completed = deferred<void>()
  vi.mocked(connectPi).mockReturnValueOnce(completed.promise)
  const reopening = useConversationStore
    .getState()
    .connect('project', 'history.jsonl', { sessionId: 'replacement' })
  expect(useConversationStore.getState()).toMatchObject({
    status: 'connecting',
    sessionId: 'replacement',
    messages: [],
    tools: [],
  })
  completed.resolve()
  await reopening
})

test('failed reconnects and cancellation preserve cached history and stale hydrations cannot replace another session', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file!))
  })
  await useConversationStore.getState().connect('project', 'A')
  await useConversationStore.getState().connect('project', 'B')
  vi.mocked(connectPi).mockRejectedValueOnce(new Error('助手启动失败'))
  await useConversationStore.getState().connect('project', 'A')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'disconnected',
    instanceId: null,
    messages: [{ text: '回复 A' }],
    error: 'Error: 助手启动失败',
  })
  let staleHydrate!: (value: RuntimeSnapshot) => void
  let finish!: () => void
  vi.mocked(connectPi).mockImplementationOnce((_project, hydrate) => {
    staleHydrate = hydrate
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const pending = useConversationStore.getState().connect('project', 'A')
  await useConversationStore.getState().disconnect()
  expect(useConversationStore.getState()).toMatchObject({
    status: 'disconnected',
    connectionTarget: { projectPath: 'project', sessionPath: 'A' },
    messages: [{ text: '回复 A' }],
    error: null,
  })
  await useConversationStore.getState().connect('project', 'B')
  staleHydrate(sessionSnapshot('A', '不能覆盖当前会话'))
  finish()
  await pending
  expect(useConversationStore.getState()).toMatchObject({
    sessionFile: 'B',
    status: 'ready',
    messages: [{ text: '回复 B' }],
  })
})

test('opening the current session is a no-op while forced refreshes and new chats still connect', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file ?? 'new'))
  })
  await useConversationStore.getState().connect('project', 'A')
  await useConversationStore.getState().connect('project', 'a')
  expect(connectPi).toHaveBeenCalledTimes(1)
  await useConversationStore.getState().connect('project', 'A', { force: true })
  expect(connectPi).toHaveBeenCalledTimes(2)
  let finish!: () => void
  vi.mocked(connectPi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = useConversationStore.getState().connect('project', 'B')
  await useConversationStore.getState().connect('project', 'b')
  expect(connectPi).toHaveBeenCalledTimes(3)
  finish()
  await pending
  await useConversationStore.getState().connect('project')
  await useConversationStore.getState().connect('project')
  expect(connectPi).toHaveBeenCalledTimes(5)
})

test('new chats preview their configured default while clearing the old runtime and history before sending', async () => {
  const models = [snapshot.model!]
  const defaultModel = { ...snapshot.model!, id: 'configured-default' }
  useConversationStore.setState({
    instanceId: 'old-runtime',
    sessionId: 'old-session',
    sessionFile: 'old.jsonl',
    status: 'ready',
    model: snapshot.model,
    models,
    thinkingLevel: 'high',
    messages: [{ ...message, text: '仅属于旧会话', status: 'complete' }],
    timeline: [{ kind: 'message', id: message.id }],
    blocks: { [message.id]: { 0: { kind: 'text', text: '旧内容' } } },
  })
  let hydrate!: (value: RuntimeSnapshot) => void
  let finish!: () => void
  vi.mocked(connectPi).mockImplementation((_project, onSnapshot) => {
    hydrate = onSnapshot
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const pending = useConversationStore.getState().connect('project', undefined, { defaultModel })
  expect(useConversationStore.getState()).toMatchObject({
    status: 'connecting',
    instanceId: null,
    sessionId: null,
    sessionFile: null,
    messages: [],
    timeline: [],
    blocks: {},
    model: defaultModel,
    thinkingLevel: 'high',
    availableThinkingLevels: snapshot.availableThinkingLevels,
  })
  expect(useConversationStore.getState().models).toBe(models)
  expect(await useConversationStore.getState().send('等待新会话准备好')).toBe(false)
  expect(sendPiMessage).not.toHaveBeenCalled()
  const obsoleteHydrate = hydrate
  const finishOld = finish
  const latest = useConversationStore.getState().connect('other-project')
  expect(useConversationStore.getState().models).toBe(models)
  obsoleteHydrate(sessionSnapshot('obsolete'))
  expect(useConversationStore.getState().instanceId).toBeNull()
  const fresh = {
    ...snapshot,
    instanceId: 'new-runtime',
    sessionId: 'new-session',
    sessionFile: 'new.jsonl',
    model: { ...snapshot.model!, id: 'authoritative-model' },
  }
  vi.mocked(setPiThinkingLevel).mockResolvedValue(fresh)
  hydrate(fresh)
  finishOld()
  finish()
  await Promise.all([pending, latest])
  expect(useConversationStore.getState()).toMatchObject({
    status: 'ready',
    instanceId: fresh.instanceId,
    sessionFile: fresh.sessionFile,
    model: fresh.model,
    messages: [],
  })
})

test('repeated new-chat requests reuse the pending and ready empty session without resetting its UI', async () => {
  let hydrate!: (value: RuntimeSnapshot) => void
  let finish!: () => void
  vi.mocked(connectPi).mockImplementation((_project, onSnapshot) => {
    hydrate = onSnapshot
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const pending = useConversationStore.getState().connect('D:/Project')
  const connecting = useConversationStore.getState()
  for (let index = 0; index < 10; index++) {
    await useConversationStore.getState().connect('d:\\project')
  }
  expect(connectPi).toHaveBeenCalledTimes(1)
  expect(useConversationStore.getState()).toBe(connecting)

  const fresh = { ...snapshot, sessionFile: 'empty.jsonl' }
  vi.mocked(setPiThinkingLevel).mockResolvedValue(fresh)
  hydrate(fresh)
  finish()
  await pending
  const ready = useConversationStore.getState()
  await useConversationStore.getState().connect('D:/Project')
  expect(connectPi).toHaveBeenCalledTimes(1)
  expect(useConversationStore.getState()).toBe(ready)

  useConversationStore.setState({
    messages: [{ ...message, text: '已经发送', status: 'complete' }],
  })
  vi.mocked(connectPi).mockImplementation(async (_project, onSnapshot) => onSnapshot(fresh))
  await useConversationStore.getState().connect('D:/Project')
  expect(connectPi).toHaveBeenCalledTimes(2)
  await useConversationStore.getState().connect('another-project')
  expect(connectPi).toHaveBeenCalledTimes(3)
  await useConversationStore.getState().connect('another-project', null, { force: true })
  expect(connectPi).toHaveBeenCalledTimes(4)
})

test('a failed new-chat request remains retryable for the same project', async () => {
  vi.mocked(connectPi).mockRejectedValueOnce(new Error('连接失败'))
  await useConversationStore.getState().connect(null)
  expect(useConversationStore.getState().status).toBe('disconnected')
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate) => hydrate(snapshot))
  await useConversationStore.getState().connect(null)
  expect(connectPi).toHaveBeenCalledTimes(2)
  expect(useConversationStore.getState().status).toBe('ready')
})

test('navigating away during a forced refresh keeps the latest local transcript in cache', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file!))
  })
  await useConversationStore.getState().connect('project', 'A')
  useConversationStore.setState({
    messages: [{ ...message, text: '最新本地回复', status: 'complete' }],
  })
  let finishRefresh!: () => void
  vi.mocked(connectPi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRefresh = resolve
      }),
  )
  const refresh = useConversationStore.getState().connect('project', 'A', { force: true })
  await useConversationStore.getState().connect('project', 'B')
  let finishReturn!: () => void
  vi.mocked(connectPi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishReturn = resolve
      }),
  )
  const returning = useConversationStore.getState().connect('project', 'A')
  expect(useConversationStore.getState().messages[0].text).toBe('最新本地回复')
  finishRefresh()
  finishReturn()
  await Promise.all([refresh, returning])
})

test('cached process records cannot restore a tool approval or a running state', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file!))
  })
  await useConversationStore.getState().connect('project', 'A')
  useConversationStore.setState({
    tools: [
      {
        id: 'old-tool',
        toolCallId: 'old-tool',
        runId: 'old-run',
        name: 'write',
        summary: 'notes.txt',
        arguments: '{}',
        argumentsTruncated: false,
        output: '',
        outputTruncated: false,
        status: 'awaiting_approval',
        approvalId: 'expired-approval',
        durationMs: null,
      },
    ],
  })
  await useConversationStore.getState().connect('project', 'B')
  let finish!: () => void
  vi.mocked(connectPi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = useConversationStore.getState().connect('project', 'A')
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: null,
    activeRunId: null,
    status: 'connecting',
    tools: [{ status: 'interrupted', approvalId: null }],
  })
  finish()
  await pending
})

test('the recent-session cache evicts old and oversized histories', async () => {
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate, _events, file) => {
    hydrate(sessionSnapshot(file!))
  })
  for (let index = 0; index < 9; index++) {
    await useConversationStore.getState().connect('project', `${index}`)
  }
  expect(useConversationStore.getState().sessionCache.size).toBe(8)
  // Touch the oldest remaining entry before adding another conversation.
  await useConversationStore.getState().connect('project', '1')
  await useConversationStore.getState().connect('project', '9')
  expect(useConversationStore.getState().sessionCache.has('id:1')).toBe(true)
  expect(useConversationStore.getState().sessionCache.has('id:2')).toBe(false)
  vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) => {
    hydrate(sessionSnapshot('huge', 'x'.repeat(16_000_001)))
  })
  await useConversationStore.getState().connect('project', 'huge')
  expect(useConversationStore.getState().messages[0].text.length).toBe(16_000_001)
  expect(useConversationStore.getState().sessionCache.has('id:huge')).toBe(false)
  let finish!: () => void
  vi.mocked(connectPi).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = useConversationStore.getState().connect('project', '0')
  expect(useConversationStore.getState().messages).toEqual([])
  expect(useConversationStore.getState().model).toBeNull()
  finish()
  await pending
  for (const file of ['large-A', 'large-B']) {
    vi.mocked(connectPi).mockImplementationOnce(async (_project, hydrate) => {
      hydrate(sessionSnapshot(file, 'x'.repeat(8_000_000)))
    })
    await useConversationStore.getState().connect('project', file)
  }
  expect(useConversationStore.getState().sessionCache.has('id:large-A')).toBe(false)
  expect(useConversationStore.getState().sessionCache.has('id:large-B')).toBe(true)
})

test('tools interleave with messages and cumulative output replaces the previous preview', () => {
  let state: ConversationData = { ...emptyConversation, instanceId: 'pi-1', activeRunId: 'run-1' }
  const tool: ToolCall = {
    id: 'tool-1',
    toolCallId: 'source-1',
    runId: 'run-1',
    name: 'powershell',
    summary: 'example',
    arguments: '{}',
    argumentsTruncated: false,
    output: '',
    outputTruncated: false,
    status: 'awaiting_approval',
    approvalId: 'approval-1',
    durationMs: null,
  }
  state = reducePiEvent(state, event(1, { type: 'message_started', message }))
  state = reducePiEvent(state, event(2, { type: 'tool_changed', tool }))
  expect(state.activity).toContain('确认')
  state = reducePiEvent(
    state,
    event(3, { type: 'tool_changed', tool: { ...tool, status: 'running', output: 'a' } }),
  )
  state = reducePiEvent(
    state,
    event(4, { type: 'tool_changed', tool: { ...tool, status: 'running', output: 'ab' } }),
  )
  state = reducePiEvent(
    state,
    event(5, { type: 'message_started', message: { ...message, id: 'assistant-2' } }),
  )
  expect(state.tools[0].output).toBe('ab')
  expect(state.timeline.map((entry) => entry.id)).toEqual(['assistant-1', 'tool-1', 'assistant-2'])
  state = reducePiEvent(state, event(6, { type: 'disconnected', error: 'closed' }))
  expect(state.tools[0].status).toBe('interrupted')
  expect(state.tools[0].approvalId).toBeNull()
})

test('streamed blocks stay in content order and final message replaces partial output', () => {
  let state: ConversationData = { ...emptyConversation, instanceId: 'pi-1', activeRunId: 'run-1' }
  state = reducePiEvent(state, event(1, { type: 'message_started', message }))
  state = reducePiEvent(
    state,
    event(2, {
      type: 'message_delta',
      messageId: message.id,
      contentIndex: 1,
      kind: 'text',
      delta: '世界',
    }),
  )
  state = reducePiEvent(
    state,
    event(3, {
      type: 'message_delta',
      messageId: message.id,
      contentIndex: 0,
      kind: 'text',
      delta: '你好，',
    }),
  )
  expect(state.messages[0].text).toBe('你好，世界')
  state = reducePiEvent(
    state,
    event(4, {
      type: 'message_completed',
      message: { ...message, text: '权威最终回复', status: 'complete' },
    }),
  )
  expect(state.messages[0].text).toBe('权威最终回复')
  expect(state.blocks[message.id]).toBeUndefined()
})

test('late, duplicated, and previous-process events cannot change the current run', () => {
  const state = {
    ...emptyConversation,
    instanceId: 'pi-1',
    sequence: 5,
    activeRunId: 'run-2',
    status: 'running' as const,
  }
  expect(reducePiEvent(state, event(4, { type: 'disconnected', error: 'old' }))).toBe(state)
  expect(reducePiEvent(state, event(6, { type: 'disconnected', error: 'old' }, 'pi-old'))).toBe(
    state,
  )
  const next = reducePiEvent(
    state,
    event(6, { type: 'run_finished', status: 'complete', error: null }, 'pi-1', 'run-1'),
  )
  expect(next.status).toBe('running')
  expect(next.activeRunId).toBe('run-2')
})

test('a fast completion before prompt acknowledgement is not changed back to running', async () => {
  useConversationStore.setState({
    ...snapshot,
    status: 'ready',
    instanceId: snapshot.instanceId,
    activeRunId: null,
  })
  vi.mocked(sendPiMessage).mockImplementation(async (_instance, runId) => {
    useConversationStore
      .getState()
      .receive([event(1, { type: 'run_finished', status: 'complete', error: null }, 'pi-1', runId)])
  })
  expect(await useConversationStore.getState().send('你好')).toBe(true)
  expect(useConversationStore.getState().status).toBe('ready')
})

test('stop stays pending until Pi confirms it and blocks another send', async () => {
  useConversationStore.setState({ instanceId: 'pi-1', status: 'running', activeRunId: 'run-1' })
  vi.mocked(stopPi).mockResolvedValue()
  await useConversationStore.getState().stop()
  expect(useConversationStore.getState().status).toBe('stopping')
  expect(await useConversationStore.getState().send('another')).toBe(false)
  useConversationStore
    .getState()
    .receive([event(1, { type: 'run_finished', status: 'cancelled', error: null })])
  expect(useConversationStore.getState().status).toBe('ready')
})

test('connection failures are actionable and do not fabricate a ready model', async () => {
  vi.mocked(connectPi).mockRejectedValue('没有可用模型，请在 CC Switch 中检查配置。')
  await useConversationStore.getState().connect('project')
  expect(useConversationStore.getState().status).toBe('disconnected')
  expect(useConversationStore.getState().error).toContain('CC Switch')
  expect(useConversationStore.getState().model).toBeNull()
})

test('a delayed run-start event cannot undo a pending stop', () => {
  const state: ConversationData = {
    ...emptyConversation,
    instanceId: 'pi-1',
    activeRunId: 'run-1',
    status: 'stopping',
  }
  const next = reducePiEvent(
    state,
    event(1, { type: 'run_started', message: { ...message, role: 'user', text: 'hello' } }),
  )
  expect(next.status).toBe('stopping')
  expect(next.activity).toBe('正在停止…')
})

test('unsupported efforts are rejected while supported levels and Default can be selected', async () => {
  useConversationStore.setState({
    instanceId: 'pi-1',
    status: 'ready',
    thinkingLevel: 'medium',
    availableThinkingLevels: ['off', 'high'],
  })
  vi.mocked(setPiThinkingLevel).mockImplementation(async (_instanceId, thinkingLevel) => ({
    ...snapshot,
    thinkingLevel,
    availableThinkingLevels: ['off', 'high'],
  }))
  for (const level of ['low', 'medium', 'xhigh', 'max']) {
    await useConversationStore.getState().changeThinkingLevel(level)
  }
  expect(setPiThinkingLevel).not.toHaveBeenCalled()
  for (const level of ['off', 'high', 'default']) {
    await useConversationStore.getState().changeThinkingLevel(level)
    expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-1', level)
    expect(useConversationStore.getState()).toMatchObject({
      status: 'ready',
      thinkingLevel: level,
      requestedThinkingLevel: level,
      settingsPending: null,
    })
    expect(loadThinkingPreference()).toBe(level)
  }
  useConversationStore.setState({ availableThinkingLevels: ['high'] })
  await useConversationStore.getState().changeThinkingLevel('off')
  expect(setPiThinkingLevel).toHaveBeenCalledTimes(3)
  useConversationStore.setState({ status: 'running' })
  await useConversationStore.getState().changeThinkingLevel('low')
  expect(setPiThinkingLevel).toHaveBeenCalledTimes(3)
})

test('Off is sent to Pi and restored from preferences when reconnecting', async () => {
  useConversationStore.setState({ ...snapshot, status: 'ready' })
  vi.mocked(setPiThinkingLevel).mockImplementation(async (instanceId, level) => ({
    ...snapshot,
    instanceId,
    thinkingLevel: level,
  }))
  await useConversationStore.getState().changeThinkingLevel('off')
  expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-1', 'off')
  expect(loadThinkingPreference()).toBe('off')

  useConversationStore.setState(useConversationStore.getInitialState(), true)
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate) => {
    hydrate({ ...snapshot, instanceId: 'pi-off-restored' })
  })
  await useConversationStore.getState().connect('project')
  expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-off-restored', 'off')
  expect(useConversationStore.getState()).toMatchObject({
    thinkingLevel: 'off',
    requestedThinkingLevel: 'off',
    settingsPending: null,
    status: 'ready',
  })
})

test('turn timing uses native start and finish events rather than the time the UI received them', () => {
  const state: ConversationData = { ...emptyConversation, instanceId: 'pi-1' }
  const started = reducePiEvent(
    state,
    event(1, {
      type: 'run_started',
      message: {
        ...message,
        id: 'run-1-user',
        role: 'user',
        text: '你好',
        status: 'complete',
        startedAt: 100_000,
      },
    }),
  )
  const finished = reducePiEvent(
    started,
    event(2, { type: 'run_finished', status: 'complete', error: null, finishedAt: 121_000 }),
  )
  expect(finished.messages[0]).toMatchObject({ startedAt: 100_000, finishedAt: 121_000 })
  expect(finished.lastLocalActivityAt).toBe(121_000)
  expect(finished.activeRunId).toBeNull()
})

test('a failed thinking change preserves the selected effort and a late result cannot replace a new session', async () => {
  useConversationStore.setState({
    instanceId: 'pi-1',
    status: 'ready',
    thinkingLevel: 'medium',
    availableThinkingLevels: snapshot.availableThinkingLevels,
  })
  vi.mocked(setPiThinkingLevel).mockRejectedValueOnce(new Error('setting failed'))
  await useConversationStore.getState().changeThinkingLevel('high')
  expect(useConversationStore.getState()).toMatchObject({
    status: 'ready',
    thinkingLevel: 'medium',
    error: 'Error: setting failed',
  })
  let finish!: (value: RuntimeSnapshot) => void
  vi.mocked(setPiThinkingLevel).mockImplementation((instanceId) =>
    instanceId === 'pi-1'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve({ ...snapshot, instanceId: 'pi-2', thinkingLevel: 'high' }),
  )
  const pending = useConversationStore.getState().changeThinkingLevel('max')
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate) => {
    hydrate({ ...snapshot, instanceId: 'pi-2' })
  })
  await useConversationStore.getState().connect('other')
  finish({ ...snapshot, thinkingLevel: 'max' })
  await pending
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'pi-2',
    thinkingLevel: 'high',
    requestedThinkingLevel: 'default',
    settingsPending: null,
    status: 'ready',
  })
})

test('unsupported manual efforts fall back to Default on model changes and reconnects keep Default', async () => {
  useConversationStore.setState({ instanceId: 'pi-1', status: 'ready', model: snapshot.model })
  vi.mocked(setPiThinkingLevel).mockImplementation(async (instanceId) => ({
    ...snapshot,
    instanceId,
    thinkingLevel: 'high',
    availableThinkingLevels: ['off', 'high'],
  }))
  await useConversationStore.getState().changeThinkingLevel('low')
  expect(loadThinkingPreference()).toBe('low')
  expect(useConversationStore.getState()).toMatchObject({
    requestedThinkingLevel: 'low',
    thinkingLevel: 'high',
  })
  const model = { provider: 'other', id: 'next', name: 'Next' }
  vi.mocked(setPiModel).mockResolvedValue({ ...snapshot, model, thinkingLevel: 'off' })
  vi.mocked(setPiThinkingLevel).mockResolvedValue({ ...snapshot, model, thinkingLevel: 'high' })
  await useConversationStore.getState().changeModel(model)
  expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-1', 'low')
  expect(useConversationStore.getState()).toMatchObject({
    model,
    requestedThinkingLevel: 'low',
    thinkingLevel: 'high',
  })
  vi.mocked(setPiModel).mockResolvedValue({
    ...snapshot,
    model,
    thinkingLevel: 'high',
    availableThinkingLevels: ['off', 'high'],
  })
  await useConversationStore.getState().changeModel(model)
  expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-1', 'default')
  expect(useConversationStore.getState().requestedThinkingLevel).toBe('default')
  expect(loadThinkingPreference()).toBe('default')
  useConversationStore.setState(useConversationStore.getInitialState(), true)
  vi.mocked(connectPi).mockImplementation(async (_project, hydrate) => {
    hydrate({ ...snapshot, instanceId: 'pi-2' })
  })
  vi.mocked(setPiThinkingLevel).mockResolvedValue({
    ...snapshot,
    instanceId: 'pi-2',
    thinkingLevel: 'high',
  })
  await useConversationStore.getState().connect('project')
  expect(setPiThinkingLevel).toHaveBeenLastCalledWith('pi-2', 'default')
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: 'pi-2',
    status: 'ready',
    requestedThinkingLevel: 'default',
    thinkingLevel: 'high',
    settingsPending: null,
  })
})

test.each(['model', 'thinking'] as const)(
  'changing %s preserves the transcript and serializes newer choices before allowing a send',
  async (kind) => {
    const messages = [{ ...message, text: '保留回复', status: 'complete' }]
    const timeline = [{ kind: 'message', id: message.id }]
    const tools: ToolCall[] = []
    const blocks = {}
    useConversationStore.setState({
      instanceId: 'pi-1',
      status: 'ready',
      messages,
      timeline,
      tools,
      blocks,
      activity: '已停止生成',
      sequence: 42,
    })
    let finish!: (value: RuntimeSnapshot) => void
    const result = new Promise<RuntimeSnapshot>((resolve) => {
      finish = resolve
    })
    vi.mocked(setPiModel).mockReturnValue(result)
    vi.mocked(setPiThinkingLevel).mockReturnValue(result)
    const states: string[] = []
    const unsubscribe = useConversationStore.subscribe((state) => states.push(state.status))
    try {
      const pending =
        kind === 'model'
          ? useConversationStore.getState().changeModel(snapshot.model!)
          : useConversationStore.getState().changeThinkingLevel('low')
      expect(useConversationStore.getState().settingsPending).toBe(kind)
      expect(await useConversationStore.getState().send('不能抢先发送')).toBe(false)
      const modelChange = useConversationStore.getState().changeModel(snapshot.model!)
      const thinkingChange = useConversationStore.getState().changeThinkingLevel('high')
      expect(setPiModel).toHaveBeenCalledTimes(kind === 'model' ? 1 : 0)
      expect(setPiThinkingLevel).toHaveBeenCalledTimes(kind === 'thinking' ? 1 : 0)
      finish(snapshot)
      await Promise.all([pending, modelChange, thinkingChange])
      const state = useConversationStore.getState()
      expect(states.every((status) => status === 'ready')).toBe(true)
      expect(state.messages).toBe(messages)
      expect(state.timeline).toBe(timeline)
      expect(state.tools).toBe(tools)
      expect(state.blocks).toBe(blocks)
      expect(state.activity).toBe('已停止生成')
      expect(state.sequence).toBe(42)
      expect(state.settingsPending).toBeNull()
      expect(state.pendingSettings).toBeNull()
      expect(state.requestedThinkingLevel).toBe('high')
    } finally {
      unsubscribe()
    }
  },
)

test('failed changes keep the last saved preference and disconnected results cannot revive settings', async () => {
  saveThinkingPreference('medium')
  useConversationStore.setState({
    instanceId: 'pi-1',
    status: 'ready',
    requestedThinkingLevel: 'medium',
  })
  vi.mocked(setPiThinkingLevel).mockRejectedValueOnce('setting failed')
  await useConversationStore.getState().changeThinkingLevel('low')
  expect(useConversationStore.getState().requestedThinkingLevel).toBe('medium')
  expect(loadThinkingPreference()).toBe('medium')
  let finish!: (value: RuntimeSnapshot) => void
  vi.mocked(setPiThinkingLevel).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const pending = useConversationStore.getState().changeThinkingLevel('max')
  useConversationStore.getState().receive([event(1, { type: 'disconnected', error: 'closed' })])
  finish(snapshot)
  await pending
  expect(useConversationStore.getState()).toMatchObject({
    instanceId: null,
    status: 'disconnected',
    settingsPending: null,
    error: 'closed',
  })
  expect(loadThinkingPreference()).toBe('medium')
})
