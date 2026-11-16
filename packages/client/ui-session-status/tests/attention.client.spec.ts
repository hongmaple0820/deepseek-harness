/** Transition events the Session attention watcher derives from the reading and pending-interaction streams. */
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionAttentionWatcher, type AttentionEvent } from '../src/client/attention.ts'
import type { SessionReadSnapshot } from '../src/client/model.ts'
import type { UiSessionStatus } from '../src/client/status.ts'
import type { SessionReadState } from '../src/types.ts'

const sid = (value: string): SessionId => value as SessionId
const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

function bench() {
  const ctx = new Context()
  roots.push(ctx)
  const reading = createSnapshotStore<SessionReadSnapshot>({ items: {}, ready: false }, { flush: 'sync' })
  const pending = createSnapshotStore<ReadonlyMap<SessionId, SessionPendingInteraction>>(new Map(), { flush: 'sync' })
  // The watcher reads only the reading model and viewing session off the status table; a facade suffices.
  const status = {
    reading: { state: reading },
    viewingSession: undefined as SessionId | undefined,
  }
  const watcher = new SessionAttentionWatcher(ctx, status as unknown as UiSessionStatus, pending)
  const events: AttentionEvent[] = []
  const off = watcher.subscribe((event) => { events.push(event) })
  const record = (id: SessionId, value: Partial<SessionReadState>): SessionReadState => ({
    sessionId: id, completedTurn: 0, failed: false, readTurn: 0, manualUnread: false, ...value,
  })
  const read = (items: Record<SessionId, SessionReadState>, ready = true): void => { reading.set({ items, ready }) }
  const approval = (id: SessionId, key: string, answerable?: boolean): SessionPendingInteraction =>
    ({ key, kind: 'approval', sessionId: id, ...(answerable === undefined ? {} : { answerable }) }) as SessionPendingInteraction
  const question = (id: SessionId, key: string): SessionPendingInteraction =>
    ({ key, kind: 'question', sessionId: id }) as SessionPendingInteraction
  return {
    ctx, reading, pending, watcher, events, off, record, read, approval, question,
    setViewing: (id?: SessionId): void => { status.viewingSession = id },
  }
}

describe('Session attention transitions', () => {
  it('baselines the first synchronized reading silently and emits one event per completed turn', () => {
    const b = bench()
    const id = sid('s1')
    b.read({ [id]: b.record(id, { completedTurn: 1 }) })
    expect(b.events).toEqual([])
    b.read({ [id]: b.record(id, { completedTurn: 2 }) })
    expect(b.events).toEqual([{ kind: 'completed', sessionId: id }])
    b.read({ [id]: b.record(id, { completedTurn: 3 }) })
    expect(b.events).toEqual([
      { kind: 'completed', sessionId: id },
      { kind: 'completed', sessionId: id },
    ])
  })

  it('emits failed for a completion the Host observed as an execution error', () => {
    const b = bench()
    const id = sid('s1')
    b.read({ [id]: b.record(id, { completedTurn: 1 }) })
    b.read({ [id]: b.record(id, { completedTurn: 2, failed: true }) })
    expect(b.events).toEqual([{ kind: 'failed', sessionId: id }])
  })

  it('never emits for a manual unread mark, which does not move completedTurn', () => {
    const b = bench()
    const id = sid('s1')
    b.read({ [id]: b.record(id, { completedTurn: 2, readTurn: 2 }) })
    expect(b.events).toEqual([])
    b.read({ [id]: b.record(id, { completedTurn: 2, readTurn: 2, manualUnread: true }) })
    expect(b.events).toEqual([])
  })

  it('does not emit a completion that is already acknowledged', () => {
    const b = bench()
    const id = sid('s1')
    b.read({ [id]: b.record(id, { completedTurn: 1 }) })
    b.read({ [id]: b.record(id, { completedTurn: 2, readTurn: 2 }) })
    expect(b.events).toEqual([])
  })

  it('re-baselines silently across a disconnect and reconnect', () => {
    const b = bench()
    const id = sid('s1')
    b.read({ [id]: b.record(id, { completedTurn: 1 }) })
    b.read({ [id]: b.record(id, { completedTurn: 2 }) })
    expect(b.events).toHaveLength(1)
    b.read({}, false)
    b.read({ [id]: b.record(id, { completedTurn: 3 }) })
    expect(b.events).toHaveLength(1)
    b.read({ [id]: b.record(id, { completedTurn: 4 }) })
    expect(b.events).toHaveLength(2)
    expect(b.events[1]).toEqual({ kind: 'completed', sessionId: id })
  })

  it('drops the ledger for a Session that leaves both sources, so its reappearance notifies again', () => {
    const b = bench()
    const id = sid('s1')
    b.read({ [id]: b.record(id, { completedTurn: 1 }) })
    expect(b.events).toEqual([])
    b.read({})
    b.read({ [id]: b.record(id, { completedTurn: 1 }) })
    expect(b.events).toEqual([{ kind: 'completed', sessionId: id }])
  })

  it('emits approval and question gains per key change, once per key, and skips delegated approvals', () => {
    const b = bench()
    const id = sid('s1')
    b.pending.set(new Map([[id, b.approval(id, 'approval:1')]]))
    expect(b.events).toEqual([{ kind: 'approval', sessionId: id, key: 'approval:1' }])

    b.pending.set(new Map([[id, b.approval(id, 'approval:1')]]))
    expect(b.events).toHaveLength(1)

    b.pending.set(new Map([[id, b.approval(id, 'approval:2')]]))
    expect(b.events).toHaveLength(2)
    expect(b.events[1]).toEqual({ kind: 'approval', sessionId: id, key: 'approval:2' })

    b.pending.set(new Map([[id, b.question(id, 'question:1')]]))
    expect(b.events).toHaveLength(3)
    expect(b.events[2]).toEqual({ kind: 'question', sessionId: id, key: 'question:1' })

    b.pending.set(new Map([[id, b.approval(id, 'approval:3', false)]]))
    expect(b.events).toHaveLength(3)
  })

  it('suppresses every transition of the visible focused main-view Session', () => {
    const b = bench()
    const viewed = sid('viewed')
    const other = sid('other')
    b.setViewing(viewed)
    b.read({ [viewed]: b.record(viewed, { completedTurn: 1 }), [other]: b.record(other, { completedTurn: 1 }) })
    b.read({ [viewed]: b.record(viewed, { completedTurn: 2 }), [other]: b.record(other, { completedTurn: 2 }) })
    expect(b.events).toEqual([{ kind: 'completed', sessionId: other }])
  })

  it('reports a throwing listener and continues to later listeners', () => {
    const b = bench()
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    b.off()
    const failure = new Error('attention subscriber failed')
    b.watcher.subscribe(() => { throw failure })
    const after = vi.fn()
    b.watcher.subscribe(after)
    const id = sid('s1')

    b.read({ [id]: b.record(id, { completedTurn: 1 }) })
    b.read({ [id]: b.record(id, { completedTurn: 2 }) })

    expect(after).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith('[session-attention] subscriber failed:', failure)
  })
})
