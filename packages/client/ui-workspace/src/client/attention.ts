/** In-app session attention: one live notice per session, owned by the Workspace plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { AttentionEvent } from '@deepseek-ai/dsh-client-ui-session-status/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: load the approval pending-interaction merge so kind narrowing reaches PendingApproval.
import type { ApprovalDecision, PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import { WORKSPACE_SETTINGS_NAMESPACE, type WorkspaceSettings } from '../attention-settings.ts'
import { ATTENTION_HOLD_MS, type ApprovalAttentionNotice, type AttentionNotice } from './contract/attention.ts'

/** Notice state and the operations the stacked cards offer. */
export interface AttentionNotices {
  /** Renderer-bound live notices, newest last. */
  readonly hooks: { attention: HostObservable<readonly AttentionNotice[]> }
  /** Drop one notice without opening its session. */
  dismiss(sessionId: SessionId): void
  /** Open the session and drop its notice. */
  view(sessionId: SessionId): void
  /** Allow the session's live approval request. */
  allow(sessionId: SessionId): Promise<void>
  /** Reject the session's live approval request. */
  deny(sessionId: SessionId): Promise<void>
}

/**
 * Surface the transition watcher's events as in-app notices.
 *
 * A present reader sees one card per session: a new transition replaces the
 * previous card instead of stacking a second one. Completed and failed cards
 * expire on their own; approval and question cards live exactly as long as the
 * pending interaction they mirror.
 *
 * @param ctx - Workspace plugin context.
 * @param sessions - session directory, read for display titles.
 * @param openSession - View action destination.
 * @returns the notice store and its card operations.
 */
export function installAttentionNotices(
  ctx: Context,
  sessions: Pick<ISessions, 'list'>,
  openSession: (sessionId: SessionId) => void,
): AttentionNotices {
  const form = ctx.configForms.get<WorkspaceSettings>(WORKSPACE_SETTINGS_NAMESPACE)
  const store = createSnapshotStore<readonly AttentionNotice[]>([])
  const timers = new Map<SessionId, ReturnType<typeof setTimeout>>()
  let seq = 0

  const approvalOf = (sessionId: SessionId): PendingApproval | undefined => {
    const interaction = ctx.uiSession.pendingInteractions.getSnapshot().get(sessionId)
    return interaction?.kind === 'approval' ? interaction : undefined
  }

  const clearTimer = (sessionId: SessionId): void => {
    const timer = timers.get(sessionId)
    if (timer === undefined) return
    clearTimeout(timer)
    timers.delete(sessionId)
  }

  const remove = (sessionId: SessionId): void => {
    clearTimer(sessionId)
    const current = store.getSnapshot()
    const next = current.filter(notice => notice.sessionId !== sessionId)
    if (next.length !== current.length) store.set(next)
  }

  const removeAll = (): void => {
    for (const sessionId of [...timers.keys()]) clearTimer(sessionId)
    if (store.getSnapshot().length > 0) store.set([])
  }

  const approvalNotice = (approval: PendingApproval, base: NoticeBase): ApprovalAttentionNotice => ({
    ...base,
    kind: 'approval',
    toolName: approval.toolName,
    reason: approval.displayReason === undefined
      ? approval.reason
      : ctx.locale.resolveText(approval.displayReason),
    answerable: approval.answerable,
  })

  const raise = (event: AttentionEvent): void => {
    // Only a reader looking at the page gets an in-app notice; the hidden case is the OS channel's.
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    if (form.getSnapshot().value?.inAppAttention === false) return
    const base: NoticeBase = {
      sessionId: event.sessionId,
      seq: ++seq,
      title: sessions.list.getSnapshot().byId[event.sessionId]?.displayTitle ?? event.sessionId,
    }
    let notice: AttentionNotice
    if (event.kind === 'approval') {
      const approval = approvalOf(event.sessionId)
      if (approval === undefined) return
      notice = approvalNotice(approval, base)
    } else if (event.kind === 'question') {
      notice = { ...base, kind: 'question' }
    } else {
      notice = { ...base, kind: event.kind }
      clearTimer(event.sessionId)
      timers.set(event.sessionId, setTimeout(() => { remove(event.sessionId) }, ATTENTION_HOLD_MS))
    }
    store.set([...store.getSnapshot().filter(current => current.sessionId !== event.sessionId), notice])
  }

  const refresh = (): void => {
    const current = store.getSnapshot()
    const next: AttentionNotice[] = []
    let changed = false
    for (const notice of current) {
      const interaction = ctx.uiSession.pendingInteractions.getSnapshot().get(notice.sessionId)
      if (notice.kind === 'completed' || notice.kind === 'failed') {
        next.push(notice)
        continue
      }
      if (notice.kind === 'approval') {
        const approval = interaction?.kind === 'approval' ? interaction : undefined
        if (approval === undefined) {
          changed = true
          continue
        }
        if (approval.answerable === notice.answerable) {
          next.push(notice)
          continue
        }
        changed = true
        next.push({ ...notice, answerable: approval.answerable })
        continue
      }
      // The question interaction kind belongs to another plugin's map entry, so
      // presence is what this package can observe; a settling request drops the card.
      if (interaction !== undefined) {
        next.push(notice)
        continue
      }
      changed = true
    }
    if (changed) store.set(next)
  }

  const answer = async (sessionId: SessionId, decision: ApprovalDecision): Promise<void> => {
    const approval = approvalOf(sessionId)
    // Settled between render and click: the card is stale, so retire it.
    if (approval === undefined) {
      remove(sessionId)
      return
    }
    await approval.answer(decision)
    remove(sessionId)
  }

  ctx.effect(() => {
    const stopAttention = ctx.uiSession.attention.subscribe(raise)
    const stopPending = ctx.uiSession.pendingInteractions.subscribe(refresh)
    const stopSetting = form.subscribe(() => {
      if (form.getSnapshot().value?.inAppAttention === false) removeAll()
    })
    return () => {
      stopAttention()
      stopPending()
      stopSetting()
      removeAll()
    }
  }, 'workspace: in-app attention')

  return {
    hooks: { attention: store },
    dismiss: remove,
    view: (sessionId) => {
      remove(sessionId)
      openSession(sessionId)
    },
    allow: sessionId => answer(sessionId, 'allowed-once'),
    deny: sessionId => answer(sessionId, 'rejected'),
  }
}

/** Fields shared by every notice this module raises. */
interface NoticeBase {
  readonly sessionId: SessionId
  readonly seq: number
  readonly title: string
}
