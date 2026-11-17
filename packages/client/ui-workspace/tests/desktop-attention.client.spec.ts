/** Desktop attention bridge: how a background session becomes an OS notification. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDesktopAttention, readDesktopNotifications } from '../src/client/desktop-attention.ts'

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

afterEach(() => { vi.unstubAllGlobals() })
