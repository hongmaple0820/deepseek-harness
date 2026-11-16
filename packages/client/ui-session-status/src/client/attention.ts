/**
 * Surface-agnostic attention transitions over the Session status facts: the shared trigger core of the session
 * attention system. A consumer applies its own presence condition (in-app next to the composer, or the OS bridge when
 * the page is hidden or the window unfocused) and its own presentation; this watcher only decides what happened.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: carries the SessionPendingInteraction identity and the UiSessionService face.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UiSessionStatus } from './status.ts'

/** Attention event kinds; `approval` and `question` are pending-interaction gains. */
export type AttentionEventKind = 'completed' | 'failed' | 'approval' | 'question'

/** One attention transition; emitted exactly once per transition, never per state. */
export interface AttentionEvent {
  /** Which trigger fired. */
  readonly kind: AttentionEventKind
  /** Session the event concerns. */
  readonly sessionId: SessionId
  /** Pending request key, present for approval/question events. */
  readonly key?: string
}

/** Ledger of the last-seen raw facts, so only transitions emit. */
interface SessionAttentionFact {
  /** Latest ended turn number; an increase is a new natural completion. */
  readonly completedTurn: number
  /** Effective pending request key, so a delegation that merely changes keys stays a no-op. */
  readonly pendingKey: string | undefined
}

/** Structural contract for the approval-domain answerability the approval contract already defines. */
interface Answerable extends SessionPendingInteraction {
  readonly answerable?: boolean
}

declare module '@deepseek-ai/dsh-client-ui-session/client' {
  interface UiSessionService {
    /** Surface-agnostic attention transition stream; inject `uiSession.attention`. */
    readonly attention: SessionAttentionWatcher
  }
}

/**
 * Emit one event per attention transition, never per state, from the reading and pending-interaction streams.
 *
 * Triggers, matching the desktop-notifications proposal the [session attention system](../../README.md) shares:
 * - a new natural completion (`completedTurn` increases while `completedTurn > readTurn`) emits `completed` or `failed`;
 * - a pending approval or question gain emits `approval` or `question`.
 *
 * Exclusions: manual unread marks never move `completedTurn`, so they never emit; a delegated or aborted approval
 * reports `answerable === false`, so it is skipped by the approval contract's own signal; and the visible focused main
 * view's Session is suppressed at emit time and never re-fires after the user switches away, because the ledger records
 * the fact regardless of suppression. The first synchronized reading baseline is established silently so page load and
 * reconnect never replay a catch-up burst; pending interactions baseline on the first reconcile, which happens
 * immediately. A throwing listener is reported without stopping later listeners.
 */
export class SessionAttentionWatcher extends Service {
  private readonly previous = new Map<SessionId, SessionAttentionFact>()
  private readonly listeners = new Set<(event: AttentionEvent) => void>()
  /** First reconcile has run, so the pending-interaction baseline is established. */
  private pendingSettled = false
  /** The current reading connection has delivered a baseline we recorded silently. */
  private readingSeenReady = false
  /** `reading.ready` as of the last reconcile; a false→true edge re-baselines completions. */
  private readingConnected = false

  /**
   * @param ctx - Client root context; registers this watcher as `uiSession.attention`.
   * @param status - status table whose reading model supplies the raw completion records.
   * @param pendingInteractions - effective pending request by Session, published by ui-session.
   */
  constructor(
    ctx: Context,
    private readonly status: UiSessionStatus,
    private readonly pendingInteractions: HostObservable<ReadonlyMap<SessionId, SessionPendingInteraction>>,
  ) {
    super(ctx, 'uiSession.attention')
    ctx.effect(() => {
      const releaseReading = this.status.reading.state.subscribe(() => { this.reconcile() })
      const releasePending = this.pendingInteractions.subscribe(() => { this.reconcile() })
      this.reconcile()
      return () => {
        releaseReading()
        releasePending()
      }
    }, 'session-attention: transition watcher')
  }

  /**
   * Observe attention transitions; a throwing listener is reported without stopping later listeners.
   * @param listener - called with each transition event.
   * @returns unsubscribe.
   */
  readonly subscribe: (listener: (event: AttentionEvent) => void) => () => void = (listener) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private reconcile(): void {
    const reading = this.status.reading.state.getSnapshot()
    const pending = this.pendingInteractions.getSnapshot()
    const viewing = this.status.viewingSession
    const ready = reading.ready
    // A false→true readiness edge is a fresh reading baseline (initial load or reconnect): record it silently.
    if (ready && !this.readingConnected) this.readingSeenReady = false
    this.readingConnected = ready
    const canEmitCompletion = ready && this.readingSeenReady
    const canEmitPending = this.pendingSettled
    // Drop ledger entries whose Session no longer carries any trigger fact.
    for (const id of this.previous.keys()) {
      if (reading.items[id] === undefined && !pending.has(id)) this.previous.delete(id)
    }
    const ids = new Set<SessionId>([...(Object.keys(reading.items) as SessionId[]), ...pending.keys()])
    for (const id of ids) {
      const record = reading.items[id]
      const completed = record?.completedTurn ?? 0
      const readTurn = record?.readTurn ?? 0
      const interaction = pending.get(id)
      const pendingKey = interaction?.key
      const prev = this.previous.get(id)
      const events: AttentionEvent[] = []
      if (canEmitCompletion && completed > (prev?.completedTurn ?? 0) && completed > readTurn) {
        events.push({ kind: record?.failed === true ? 'failed' : 'completed', sessionId: id })
      }
      if (canEmitPending && pendingKey !== undefined && pendingKey !== prev?.pendingKey) {
        const answerable = (interaction as Answerable | undefined)?.answerable
        const delegatedApproval = interaction?.kind === 'approval' && answerable === false
        if (!delegatedApproval) {
          events.push({ kind: interaction?.kind === 'approval' ? 'approval' : 'question', sessionId: id, key: pendingKey })
        }
      }
      this.previous.set(id, { completedTurn: completed, pendingKey })
      if (id !== viewing) {
        for (const event of events) notifySubscribers(this.listeners, '[session-attention]', event)
      }
    }
    if (ready) this.readingSeenReady = true
    this.pendingSettled = true
  }
}
