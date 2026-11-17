/** Desktop attention bridge: how a background session becomes an OS notification. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDesktopAttention, readDesktopAttention, readDesktopNotifications } from '../src/client/desktop-attention.ts'
import type { DesktopAttentionSummary } from '../src/types.ts'

type Kind = 'completed' | 'failed' | 'approval' | 'question'
interface AttentionEvent { kind: Kind; sessionId: string }

/** A scriptable stand-in for `ctx.uiSession.attention`. */
function attentionSource() {
  const listeners: ((event: AttentionEvent) => void)[] = []
  const subscribe = vi.fn((listener: (event: AttentionEvent) => void) => {
    listeners.push(listener)
    return () => {
      const index = listeners.indexOf(listener)
      if (index !== -1) listeners.splice(index, 1)
    }
  })
  const emit = (event: AttentionEvent): void => { for (const listener of [...listeners]) listener(event) }
  return { subscribe, emit }
}

/** A scriptable stand-in for the OS-notification bridge. */
function notificationBridge() {
  const clicks: ((sessionId: string) => void)[] = []
  const notify = vi.fn(async () => {})
  const subscribe = vi.fn((listener: (sessionId: string) => void) => {
    clicks.push(listener)
    return () => {
      const index = clicks.indexOf(listener)
      if (index !== -1) clicks.splice(index, 1)
    }
  })
  const click = (sessionId: string): void => { for (const listener of [...clicks]) listener(sessionId) }
  return { notify, subscribe, click }
}

interface SetupOptions {
  visibilityState?: 'visible' | 'hidden'
  hasFocus?: boolean
  /** The workspace notifications toggle; `undefined` models an absent value. */
  notifications?: boolean | undefined
  /** The session display title; `undefined` models an unknown session. */
  title?: string | undefined
}

function setup(options: SetupOptions = {}) {
  const { visibilityState = 'hidden', hasFocus = false, notifications = true, title = 'My session' } = options
  const attention = attentionSource()
  const bridge = notificationBridge()
  const openSession = vi.fn<(sessionId: string) => void>()
  const t = vi.fn((key: string) => key)
  const form = { getSnapshot: () => ({ value: notifications === undefined ? undefined : { notifications } }) }
  const cleanups: (() => void)[] = []
  const ctx = {
    locale: { bind: () => t },
    configForms: { get: () => form },
    uiSession: { attention },
    effect: (fn: () => () => void) => { cleanups.push(fn()) },
  }
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, notifications: bridge })
  vi.stubGlobal('document', { visibilityState, hasFocus: () => hasFocus })
  const sessions = { list: { getSnapshot: () => ({ byId: title === undefined ? {} : { s1: { displayTitle: title } } }) } }
  installDesktopAttention(ctx as never, sessions as never, openSession)
  return { attention, bridge, openSession, t, cleanups }
}

describe('readDesktopNotifications', () => {
  it('returns undefined in a browser tab without a desktop carrier', () => {
    expect(readDesktopNotifications()).toBeUndefined()
  })

  it('returns undefined for an unexpected carrier protocol', () => {
    vi.stubGlobal('dshDesktop', { protocolVersion: 2, notifications: notificationBridge() })
    expect(readDesktopNotifications()).toBeUndefined()
  })

  it('returns the notifications bridge on the notifications protocol', () => {
    const bridge = notificationBridge()
    vi.stubGlobal('dshDesktop', { protocolVersion: 1, notifications: bridge })
    expect(readDesktopNotifications()).toBe(bridge)
  })
})

describe('installDesktopAttention', () => {
  it('installs nothing without a carrier', () => {
    const attention = attentionSource()
    const effect = vi.fn()
    const ctx = { locale: { bind: vi.fn() }, configForms: { get: vi.fn() }, uiSession: { attention }, effect }
    installDesktopAttention(ctx as never, { list: { getSnapshot: () => ({ byId: {} }) } } as never, vi.fn())
    expect(effect).not.toHaveBeenCalled()
    expect(attention.subscribe).not.toHaveBeenCalled()
  })

  it('does not notify while the page is visible and focused (foreground)', () => {
    const b = setup({ visibilityState: 'visible', hasFocus: true })
    b.attention.emit({ kind: 'completed', sessionId: 's1' })
    expect(b.bridge.notify).not.toHaveBeenCalled()
  })

  it('notifies a completed background session while the page is hidden', () => {
    const b = setup()
    b.attention.emit({ kind: 'completed', sessionId: 's1' })
    expect(b.bridge.notify).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1', title: 'My session', body: 'attention.completed' })
  })

  it('notifies while the page is visible but unfocused', () => {
    const b = setup({ visibilityState: 'visible', hasFocus: false })
    b.attention.emit({ kind: 'failed', sessionId: 's1' })
    expect(b.bridge.notify).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1', title: 'My session', body: 'status.failed' })
  })

  it.each([
    ['completed', 'attention.completed'],
    ['failed', 'status.failed'],
    ['approval', 'status.waitingApproval'],
    ['question', 'status.waitingAnswer'],
  ] as const)('renders the %s kind line', (kind, body) => {
    const b = setup()
    b.attention.emit({ kind, sessionId: 's1' })
    expect(b.t).toHaveBeenCalledWith(body)
    expect(b.bridge.notify).toHaveBeenCalledWith(expect.objectContaining({ body }))
  })

  it('falls back to the session id when its title is unknown', () => {
    const b = setup({ title: undefined })
    b.attention.emit({ kind: 'completed', sessionId: 'unknown' })
    expect(b.bridge.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'unknown' }))
  })

  it('does not notify when the notifications setting is disabled', () => {
    const b = setup({ notifications: false })
    b.attention.emit({ kind: 'completed', sessionId: 's1' })
    expect(b.bridge.notify).not.toHaveBeenCalled()
  })

  it('notifies when the notifications setting value is absent (defaults on)', () => {
    const b = setup({ notifications: undefined })
    b.attention.emit({ kind: 'completed', sessionId: 's1' })
    expect(b.bridge.notify).toHaveBeenCalledOnce()
  })

  it('opens the session when a notification is clicked', () => {
    const b = setup()
    b.attention.emit({ kind: 'completed', sessionId: 's1' })
    b.bridge.click('s1')
    expect(b.openSession).toHaveBeenCalledExactlyOnceWith('s1')
  })

  it('unsubscribes from both sources when the effect is disposed', () => {
    const b = setup()
    expect(b.cleanups).toHaveLength(1)
    const cleanup = b.cleanups[0]
    expect(cleanup).toBeDefined()
    cleanup?.()
    b.attention.emit({ kind: 'completed', sessionId: 's1' })
    b.bridge.click('s1')
    expect(b.bridge.notify).not.toHaveBeenCalled()
    expect(b.openSession).not.toHaveBeenCalled()
  })
})

/** One entry of the session status snapshot, as the aggregate reads it. */
interface StatusEntry {
  running?: boolean | undefined
  pendingInteraction?: { kind: 'approval'; answerable: boolean } | { kind: 'question'; answerable?: boolean } | undefined
  completionUnread: boolean
  completionFailed: boolean
  manualUnread?: boolean
}

/** A scriptable status snapshot shared by the marks tests. */
function statusSource() {
  let value: ReadonlyMap<string, StatusEntry> = new Map()
  const listeners = new Set<() => void>()
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  })
  return {
    getSnapshot: () => value,
    subscribe,
    set(next: ReadonlyMap<string, StatusEntry>): void {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** A scriptable directory snapshot shared by the marks tests. */
function directorySource(byId: Record<string, { displayTitle: string }>) {
  const listeners = new Set<() => void>()
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  })
  const emit = (): void => { for (const listener of [...listeners]) listener() }
  return { getSnapshot: () => ({ byId }), subscribe, emit }
}

interface MarksOptions {
  taskbarTray?: boolean | undefined
  titles?: Record<string, { displayTitle: string }>
  update?: DesktopAttentionSummary['update']
  notifications?: boolean
}

function marksSetup({ taskbarTray = true, titles = { s1: { displayTitle: 'My session' } }, update, notifications = false }: MarksOptions = {}) {
  const status = statusSource()
  const directory = directorySource(titles)
  const updateMock = vi.fn(update ?? (async () => {}))
  const setting: { value?: { taskbarTray: boolean } | undefined } = { value: taskbarTray === undefined ? undefined : { taskbarTray } }
  const settingListeners = new Set<() => void>()
  const form = {
    getSnapshot: () => setting,
    subscribe: (listener: () => void) => {
      settingListeners.add(listener)
      return () => { settingListeners.delete(listener) }
    },
  }
  const cleanups: (() => void)[] = []
  const ctx = {
    locale: { bind: () => vi.fn((key: string) => key) },
    configForms: { get: () => form },
    uiSession: {
      attention: attentionSource(),
      sessionStatus: status,
    },
    effect: (fn: () => () => void) => { cleanups.push(fn()) },
  }
  vi.stubGlobal('dshDesktop', {
    protocolVersion: 1,
    ...notifications ? { notifications: notificationBridge() } : {},
    attention: { update: updateMock },
  })
  vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true })
  installDesktopAttention(ctx as never, { list: directory } as never, vi.fn())
  const setSetting = (next: boolean): void => {
    setting.value = { taskbarTray: next }
    for (const listener of [...settingListeners]) listener()
  }
  return { status, directory, update: updateMock, setSetting, cleanups }
}

describe('readDesktopAttention', () => {
  it('returns undefined without a carrier', () => {
    expect(readDesktopAttention()).toBeUndefined()
  })

  it('returns the marks carrier on the current protocol', () => {
    const summary = { update: vi.fn(async () => {}) }
    vi.stubGlobal('dshDesktop', { protocolVersion: 1, attention: summary })
    expect(readDesktopAttention()).toBe(summary)
  })
})

describe('installDesktopAttention marks', () => {
  it('publishes the aggregate once on install', () => {
    const b = marksSetup()
    expect(b.update).toHaveBeenCalledExactlyOnceWith({ count: 0, sessions: [] })
  })

  it('marks a session waiting for an approval', () => {
    const b = marksSetup()
    b.status.set(new Map([['s1', { pendingInteraction: { kind: 'approval', answerable: true }, completionUnread: false, completionFailed: false }]]))
    expect(b.update).toHaveBeenLastCalledWith({
      count: 1,
      sessions: [{ sessionId: 's1', title: 'My session', kind: 'approval' }],
    })
  })

  it('marks a question and a natural completion separately', () => {
    const b = marksSetup({ titles: { s1: { displayTitle: 'Asking' }, s2: { displayTitle: 'Done' } } })
    b.status.set(new Map([
      ['s1', { pendingInteraction: { kind: 'question' }, completionUnread: false, completionFailed: false }],
      ['s2', { completionUnread: true, completionFailed: false }],
    ]))
    expect(b.update).toHaveBeenLastCalledWith({
      count: 2,
      sessions: [
        { sessionId: 's1', title: 'Asking', kind: 'question' },
        { sessionId: 's2', title: 'Done', kind: 'completed' },
      ],
    })
  })

  it('marks a failed completion as failed', () => {
    const b = marksSetup()
    b.status.set(new Map([['s1', { completionUnread: true, completionFailed: true }]]))
    expect(b.update).toHaveBeenLastCalledWith({
      count: 1,
      sessions: [{ sessionId: 's1', title: 'My session', kind: 'failed' }],
    })
  })

  it('leaves out a delegated approval the reader cannot answer', () => {
    const b = marksSetup()
    b.status.set(new Map([['s1', { pendingInteraction: { kind: 'approval', answerable: false }, completionUnread: false, completionFailed: false }]]))
    expect(b.update).toHaveBeenLastCalledWith({ count: 0, sessions: [] })
  })

  it('leaves out a manually marked unread session', () => {
    const b = marksSetup()
    b.status.set(new Map([['s1', { completionUnread: true, completionFailed: false, manualUnread: true }]]))
    expect(b.update).toHaveBeenLastCalledWith({ count: 0, sessions: [] })
  })

  it('falls back to the session id for an unknown title', () => {
    const b = marksSetup({ titles: {} })
    b.status.set(new Map([['ghost', { completionUnread: true, completionFailed: false }]]))
    expect(b.update).toHaveBeenLastCalledWith({
      count: 1,
      sessions: [{ sessionId: 'ghost', title: 'ghost', kind: 'completed' }],
    })
  })

  it('republishes only when the aggregate moves', () => {
    const b = marksSetup()
    b.status.set(new Map([['s1', { completionUnread: true, completionFailed: false }]]))
    b.status.set(new Map([['s1', { completionUnread: true, completionFailed: false }]]))
    expect(b.update).toHaveBeenCalledTimes(2)
  })

  it('clears the marks when the taskbar toggle turns off', () => {
    const b = marksSetup()
    b.status.set(new Map([['s1', { completionUnread: true, completionFailed: false }]]))
    b.setSetting(false)
    expect(b.update).toHaveBeenLastCalledWith({ count: 0, sessions: [] })
  })

  it('republishes when a session title becomes known', () => {
    const titles: Record<string, { displayTitle: string }> = {}
    const b = marksSetup({ titles })
    b.status.set(new Map([['s1', { completionUnread: true, completionFailed: false }]]))
    titles['s1'] = { displayTitle: 'Named later' }
    b.directory.emit()
    expect(b.update).toHaveBeenLastCalledWith({
      count: 1,
      sessions: [{ sessionId: 's1', title: 'Named later', kind: 'completed' }],
    })
  })

  it('logs the first failed push only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const b = marksSetup({ update: async () => { throw new Error('no shell') } })
    b.status.set(new Map([['s1', { completionUnread: true, completionFailed: false }]]))
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledOnce() })
    expect(warn).toHaveBeenCalledWith('workspace: desktop attention marks unavailable', expect.any(Error))
    warn.mockRestore()
  })

  it('clears the marks and stops listening when disposed', () => {
    const b = marksSetup()
    b.status.set(new Map([['s1', { completionUnread: true, completionFailed: false }]]))
    expect(b.cleanups).toHaveLength(1)
    b.cleanups[0]?.()
    expect(b.update).toHaveBeenLastCalledWith({ count: 0, sessions: [] })
    const calls = b.update.mock.calls.length
    b.status.set(new Map())
    expect(b.update).toHaveBeenCalledTimes(calls)
  })

  it('installs the marks for a shell with only the attention carrier', () => {
    const b = marksSetup({ notifications: false })
    expect(b.update).toHaveBeenCalledOnce()
    expect(b.cleanups).toHaveLength(1)
  })
})

afterEach(() => { vi.unstubAllGlobals() })
