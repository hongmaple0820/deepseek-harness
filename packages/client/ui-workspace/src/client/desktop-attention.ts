/** Desktop taskbar, dock, tray, and OS-notification bridge for session attention. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { AttentionEvent } from '@deepseek-ai/dsh-client-ui-session-status/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Loads the session interaction map merging so `kind === 'approval'` narrows to the live approval.
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'

/** The pending-interaction facts the OS aggregate reads; the entry itself belongs to the raising plugin. */
interface PendingInteractionFacts {
  readonly kind: string
  readonly answerable?: boolean
}
import type { DesktopAttentionSession, DesktopAttentionState, DesktopAttentionSummary, DesktopSessionNotifications } from '../types.ts'
import { WORKSPACE_SETTINGS_NAMESPACE, type WorkspaceSettings } from '../attention-settings.ts'

/** The desktop carrier the preload exposes on the product main frame. */
interface DesktopCarrier {
  protocolVersion?: number
  notifications?: DesktopSessionNotifications
  attention?: DesktopAttentionSummary
}

/**
 * The OS-notification carrier, or nothing in a browser tab.
 * @returns the preload bridge when the desktop shell provides it.
 */
export function readDesktopNotifications(): DesktopSessionNotifications | undefined {
  const carrier = (globalThis as typeof globalThis & { dshDesktop?: DesktopCarrier }).dshDesktop
  return carrier?.protocolVersion === 1 ? carrier.notifications : undefined
}

/**
 * The taskbar and tray carrier, or nothing in a browser tab.
 * @returns the preload bridge when the desktop shell provides it.
 */
export function readDesktopAttention(): DesktopAttentionSummary | undefined {
  const carrier = (globalThis as typeof globalThis & { dshDesktop?: DesktopCarrier }).dshDesktop
  return carrier?.protocolVersion === 1 ? carrier.attention : undefined
}

/** Attention kinds the notification body names. */
type AttentionKind = AttentionEvent['kind']

/**
 * The localized kind line a notification body carries.
 * @param t - workspace dictionary lookup.
 * @param kind - attention transition kind.
 * @returns the body text.
 */
function kindLine(t: TranslateNS<'workspace'>, kind: AttentionKind): string {
  switch (kind) {
    case 'completed': return t('attention.completed')
    case 'failed': return t('status.failed')
    case 'approval': return t('status.waitingApproval')
    case 'question': return t('status.waitingAnswer')
  }
}

/**
 * Forward background session attention to the desktop shell: one OS notification per transition
 * while the window is away, and the taskbar, dock, and tray aggregate on every change.
 * Browser tabs carry no `dshDesktop` carrier, so the call is a no-op there.
 * @param ctx - Workspace plugin context.
 * @param sessions - session directory, read for display titles.
 * @param openSession - click-back destination for a notification or tray row.
 */
export function installDesktopAttention(
  ctx: Context,
  sessions: Pick<ISessions, 'list'>,
  openSession: (sessionId: SessionId) => void,
): void {
  const notifications = readDesktopNotifications()
  const attention = readDesktopAttention()
  if (notifications === undefined && attention === undefined) return
  const t = ctx.locale.bind('workspace')
  const form = ctx.configForms.get<WorkspaceSettings>(WORKSPACE_SETTINGS_NAMESPACE)
  ctx.effect(() => {
    const stopAttention = ctx.uiSession.attention.subscribe((event) => {
      if (notifications === undefined) return
      // A present reader already sees the transition; no catch-up on return.
      if (document.visibilityState === 'visible' && document.hasFocus()) return
      if (form.getSnapshot().value?.notifications === false) return
      void notifications.notify({
        sessionId: event.sessionId,
        title: sessions.list.getSnapshot().byId[event.sessionId]?.displayTitle ?? event.sessionId,
        body: kindLine(t, event.kind),
      })
    })
    const stopClicks = notifications?.subscribe((sessionId) => { openSession(sessionId as SessionId) })
    if (attention === undefined) return () => { stopAttention(); stopClicks?.() }
    return installSummary(ctx, sessions, attention, form, () => { stopAttention(); stopClicks?.() })
  }, 'workspace: desktop session attention')
}

/**
 * Mirror the attention aggregate onto the OS chrome whenever it changes; the shell never polls.
 * @param ctx - Workspace plugin context.
 * @param sessions - session directory, read for display titles.
 * @param attention - taskbar and tray carrier.
 * @param form - attention preferences form; the taskbar toggle governs the marks.
 * @param dispose - tears down the notification subscriptions installed beside the marks.
 * @returns the effect teardown for the marks.
 */
function installSummary(
  ctx: Context,
  sessions: Pick<ISessions, 'list'>,
  attention: DesktopAttentionSummary,
  form: {
    getSnapshot(): { value?: WorkspaceSettings | undefined }
    subscribe(listener: () => void): () => void
  },
  dispose: () => void,
): () => void {
  const status = ctx.uiSession.sessionStatus
  let published = ''
  let logged = false
  const aggregate = (): DesktopAttentionState => {
    if (form.getSnapshot().value?.taskbarTray === false) return { count: 0, sessions: [] }
    const titles = sessions.list.getSnapshot().byId
    const items: DesktopAttentionSession[] = []
    for (const [sessionId, value] of status.getSnapshot()) {
      // The pending-interaction entry belongs to the plugin that raised it; the aggregate reads only these two facts.
      const interaction: PendingInteractionFacts | undefined = value.pendingInteraction
      // A manual unread mark states the reader's own intent, so only natural completions reach the OS.
      const unread = value.completionUnread && !value.manualUnread
      const kind: DesktopAttentionSession['kind'] | undefined = interaction === undefined
        ? unread ? (value.completionFailed ? 'failed' : 'completed') : undefined
        : interaction.kind === 'approval'
          ? interaction.answerable === false ? undefined : 'approval'
          : 'question'
      if (kind === undefined) continue
      items.push({ sessionId, title: titles[sessionId]?.displayTitle ?? sessionId, kind })
    }
    return { count: items.length, sessions: items }
  }
  const publish = (): void => {
    const state = aggregate()
    const encoded = JSON.stringify(state)
    if (encoded === published) return
    published = encoded
    void attention.update(state).catch((error: unknown) => {
      // A shell that cannot draw the marks still shows the sessions; log the first failure only.
      if (logged) return
      logged = true
      console.warn('workspace: desktop attention marks unavailable', error)
    })
  }
  const stops = [
    status.subscribe(publish),
    sessions.list.subscribe(publish),
    form.subscribe(publish),
  ]
  publish()
  return () => {
    for (const stop of stops) stop()
    dispose()
    void attention.update({ count: 0, sessions: [] }).catch((error: unknown) => {
      if (logged) return
      logged = true
      console.warn('workspace: desktop attention marks unavailable', error)
    })
  }
}
