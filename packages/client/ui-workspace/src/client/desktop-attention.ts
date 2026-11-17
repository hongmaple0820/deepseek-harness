/** Desktop OS-notification bridge for background-session attention. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { AttentionEvent } from '@deepseek-ai/dsh-client-ui-session-status/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopSessionNotifications } from '../types.ts'
import { WORKSPACE_SETTINGS_NAMESPACE, type WorkspaceSettings } from '../attention-settings.ts'

/** The desktop carrier the preload exposes on the product main frame. */
interface DesktopCarrier {
  protocolVersion?: number
  notifications?: DesktopSessionNotifications
}

/**
 * The OS-notification carrier, or nothing in a browser tab.
 * @returns the preload bridge when the desktop shell provides it.
 */
export function readDesktopNotifications(): DesktopSessionNotifications | undefined {
  const carrier = (globalThis as typeof globalThis & { dshDesktop?: DesktopCarrier }).dshDesktop
  return carrier?.protocolVersion === 1 ? carrier.notifications : undefined
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
 * Forward background session attention to the desktop shell's OS notifications.
 * Browser tabs carry no `dshDesktop` carrier, so the call is a no-op there.
 * @param ctx - Workspace plugin context.
 * @param sessions - session directory, read for display titles.
 * @param openSession - click-back destination for a notification.
 */
export function installDesktopAttention(
  ctx: Context,
  sessions: Pick<ISessions, 'list'>,
  openSession: (sessionId: SessionId) => void,
): void {
  const notifications = readDesktopNotifications()
  if (notifications === undefined) return
  const t = ctx.locale.bind('workspace')
  const form = ctx.configForms.get<WorkspaceSettings>(WORKSPACE_SETTINGS_NAMESPACE)
  ctx.effect(() => {
    const stopAttention = ctx.uiSession.attention.subscribe((event) => {
      // A present reader already sees the transition; no catch-up on return.
      if (document.visibilityState === 'visible' && document.hasFocus()) return
      if (form.getSnapshot().value?.notifications === false) return
      void notifications.notify({
        sessionId: event.sessionId,
        title: sessions.list.getSnapshot().byId[event.sessionId]?.displayTitle ?? event.sessionId,
        body: kindLine(t, event.kind),
      })
    })
    const stopClicks = notifications.subscribe((sessionId) => { openSession(sessionId as SessionId) })
    return () => { stopAttention(); stopClicks() }
  }, 'workspace: desktop session attention')
}
