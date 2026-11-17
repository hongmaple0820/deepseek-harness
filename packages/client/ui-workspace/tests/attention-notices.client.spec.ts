/** In-app attention notices: one live card per session, mirrored from the watcher. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttentionNotice } from '../src/client/contract/attention.ts'
import { installAttentionNotices } from '../src/client/attention.ts'

type Kind = 'completed' | 'failed' | 'approval' | 'question'
interface AttentionEvent { kind: Kind; sessionId: string }

/** A scriptable observable: read the value, subscribe, or push a new value. */
function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  })
  const set = (next: T): void => {
    value = next
    for (const listener of [...listeners]) listener()
  }
  return { getSnapshot: () => value, subscribe, set, listeners }
}

/** A live approval fake carrying the parts the cards read. */
function approval(key: string, options: { answerable?: boolean; toolName?: string } = {}) {
  const settle = vi.fn(async () => {})
  return {
    kind: 'approval' as const,
    key,
    toolName: options.toolName ?? 'Edit',
    reason: 'write the file',
    displayReason: undefined,
    answerable: options.answerable ?? true,
    answer: settle,
  }
}

interface SetupOptions {
  visibilityState?: 'visible' | 'hidden'
  hasFocus?: boolean
  inAppAttention?: boolean | undefined
  title?: string | undefined
  pending?: Map<string, unknown>
}

function setup(options: SetupOptions = {}) {
  const { visibilityState = 'visible', hasFocus = true, inAppAttention = true, title = 'My session' } = options
  const eventListeners = new Set<(event: AttentionEvent) => void>()
  const attention = {
    subscribe: vi.fn((listener: (event: AttentionEvent) => void) => {
      eventListeners.add(listener)
      return () => { eventListeners.delete(listener) }
    }),
  }
  const pending = source<ReadonlyMap<string, unknown>>(options.pending ?? new Map())
  const setting = source({ value: inAppAttention === undefined ? undefined : { inAppAttention } })
  const cleanups: (() => void)[] = []
  const openSession = vi.fn<(sessionId: string) => void>()
  const ctx = {
    locale: { resolveText: (text: { en: string }) => text.en },
    configForms: { get: () => ({ getSnapshot: setting.getSnapshot, subscribe: setting.subscribe }) },
    uiSession: { attention, pendingInteractions: pending },
    effect: (fn: () => () => void) => { cleanups.push(fn()) },
  }
  const sessions = { list: { getSnapshot: () => ({ byId: title === undefined ? {} : { s1: { displayTitle: title } } }) } }
  vi.stubGlobal('document', { visibilityState, hasFocus: () => hasFocus })
  const notices = installAttentionNotices(ctx as never, sessions as never, openSession)
  const current = (): readonly AttentionNotice[] => notices.hooks.attention.getSnapshot()
  const raise = (kind: Kind, sessionId = 's1'): void => {
    for (const listener of [...eventListeners]) listener({ kind, sessionId })
  }
  return { notices, current, raise, pending, setting, openSession, cleanups, eventListeners }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('installAttentionNotices', () => {
  it('raises a completion card for a present reader', () => {
    const b = setup()
    b.raise('completed')
    expect(b.current()).toHaveLength(1)
    expect(b.current()[0]).toMatchObject({ kind: 'completed', sessionId: 's1', title: 'My session' })
  })

  it('does not raise while the page is hidden', () => {
    const b = setup({ visibilityState: 'hidden' })
    b.raise('completed')
    expect(b.current()).toHaveLength(0)
  })

  it('does not raise while the window is unfocused', () => {
    const b = setup({ hasFocus: false })
    b.raise('completed')
    expect(b.current()).toHaveLength(0)
  })

  it('does not raise when the in-app toggle is off', () => {
    const b = setup({ inAppAttention: false })
    b.raise('completed')
    expect(b.current()).toHaveLength(0)
  })

  it('treats an absent toggle value as enabled', () => {
    const b = setup({ inAppAttention: undefined })
    b.raise('completed')
    expect(b.current()).toHaveLength(1)
  })

  it('replaces the card of the same session and keeps other sessions', () => {
    const b = setup()
    b.raise('completed', 's1')
    b.raise('failed', 's2')
    b.raise('completed', 's1')
    expect(b.current().map(notice => notice.sessionId)).toEqual(['s2', 's1'])
    expect(b.current()[1]?.seq).toBeGreaterThan(b.current()[0]?.seq ?? 0)
  })

  it('drops a completion card after its hold', () => {
    vi.useFakeTimers()
    const b = setup()
    b.raise('completed')
    expect(b.current()).toHaveLength(1)
    vi.advanceTimersByTime(7_999)
    expect(b.current()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(b.current()).toHaveLength(0)
  })

  it('keeps an approval card until its request settles', () => {
    vi.useFakeTimers()
    const live = approval('approval:1')
    const b = setup({ pending: new Map([['s1', live]]) })
    b.raise('approval')
    expect(b.current()[0]).toMatchObject({ kind: 'approval', toolName: 'Edit', reason: 'write the file', answerable: true })
    vi.advanceTimersByTime(60_000)
    expect(b.current()).toHaveLength(1)
  })

  it('resolves a display reason through the locale', () => {
    const live = { ...approval('approval:1'), displayReason: { en: 'Localized reason' } }
    const b = setup({ pending: new Map([['s1', live]]) })
    b.raise('approval')
    expect(b.current()[0]).toMatchObject({ reason: 'Localized reason' })
  })

  it('ignores an approval event whose request already settled', () => {
    const b = setup()
    b.raise('approval')
    expect(b.current()).toHaveLength(0)
  })

  it('updates the approval card when its answerability changes', () => {
    const live = approval('approval:1', { answerable: false })
    const b = setup({ pending: new Map([['s1', live]]) })
    b.raise('approval')
    b.pending.set(new Map([['s1', { ...live, answerable: true }]]))
    expect(b.current()[0]).toMatchObject({ kind: 'approval', answerable: true })
  })

  it('drops an approval card once the request settles', () => {
    const live = approval('approval:1')
    const b = setup({ pending: new Map([['s1', live]]) })
    b.raise('approval')
    b.pending.set(new Map())
    expect(b.current()).toHaveLength(0)
  })

  it('keeps a question card while any interaction remains and drops it after', () => {
    const live = { kind: 'question', key: 'question:1' }
    const b = setup({ pending: new Map([['s1', live]]) })
    b.raise('question')
    expect(b.current()[0]).toMatchObject({ kind: 'question' })
    b.pending.set(new Map())
    expect(b.current()).toHaveLength(0)
  })

  it('falls back to the session id when the title is unknown', () => {
    const b = setup({ title: undefined })
    b.raise('completed', 'unknown')
    expect(b.current()[0]).toMatchObject({ title: 'unknown' })
  })

  it('dismisses one card without opening its session', () => {
    const b = setup()
    b.raise('completed')
    b.notices.dismiss('s1' as never)
    expect(b.current()).toHaveLength(0)
    expect(b.openSession).not.toHaveBeenCalled()
  })

  it('opens the session and drops the card on view', () => {
    const b = setup()
    b.raise('completed')
    b.notices.view('s1' as never)
    expect(b.current()).toHaveLength(0)
    expect(b.openSession).toHaveBeenCalledExactlyOnceWith('s1')
  })

  it('answers the live approval and drops the card', async () => {
    const live = approval('approval:1')
    const b = setup({ pending: new Map([['s1', live]]) })
    b.raise('approval')
    await b.notices.allow('s1' as never)
    expect(live.answer).toHaveBeenCalledExactlyOnceWith('allowed-once')
    expect(b.current()).toHaveLength(0)
  })

  it('rejects the live approval and drops the card', async () => {
    const live = approval('approval:1')
    const b = setup({ pending: new Map([['s1', live]]) })
    b.raise('approval')
    await b.notices.deny('s1' as never)
    expect(live.answer).toHaveBeenCalledExactlyOnceWith('rejected')
    expect(b.current()).toHaveLength(0)
  })

  it('retires a card whose approval settled before the click', async () => {
    const b = setup()
    b.raise('question')
    await b.notices.allow('s1' as never)
    expect(b.current()).toHaveLength(0)
  })

  it('clears every card when the in-app toggle turns off', () => {
    const b = setup()
    b.raise('completed')
    b.raise('failed', 's2')
    expect(b.current()).toHaveLength(2)
    b.setting.set({ value: { inAppAttention: false } })
    expect(b.current()).toHaveLength(0)
  })

  it('stops listening and clears the stack when disposed', () => {
    const b = setup()
    b.raise('completed')
    expect(b.cleanups).toHaveLength(1)
    b.cleanups[0]?.()
    expect(b.current()).toHaveLength(0)
    b.raise('completed')
    expect(b.current()).toHaveLength(0)
  })
})
