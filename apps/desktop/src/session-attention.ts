/** Best-effort background session attention; a click only opens the session, never answers it. */
import { app, ipcMain, nativeImage, type BrowserWindow, type IpcMainInvokeEvent, Notification } from 'electron'
import type { DesktopAttentionState } from '@deepseek-ai/dsh-client-ui-workspace/types'
import { DESKTOP_IPC } from './ipc.ts'

/** Session kinds that pull the user's eye to the taskbar and dock; the rest only mark the count. */
const ATTENTION_KINDS: readonly string[] = ['approval', 'question', 'completed', 'failed']

/** The window capabilities a notification click exercises. */
export type AttentionNotifyWindow = Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'restore' | 'show' | 'focus'>
  & { readonly webContents: { send(channel: string, sessionId: string): void } }

/** The window capabilities taskbar marks exercise; the overlay bitmap stays opaque to this module. */
export type AttentionChromeTarget = Pick<BrowserWindow, 'isDestroyed' | 'flashFrame'>
  & { setOverlayIcon(icon: unknown, description: string): void }

/** Tray surface the aggregate mirrors; the tray owns its own presentation. */
export interface AttentionTrayTarget {
  /**
   * Reflect one aggregate on the tray icon, tooltip, and menu.
   * @param state - complete current aggregate.
   */
  setAttention(state: DesktopAttentionState): void
}

/**
 * Owns one live OS notification per session, closing the previous before showing the next.
 *
 * Mirrors `DesktopUpdateAttention`: `Notification.isSupported()` guard, failed-event cleanup,
 * silent degradation with one logged diagnostic, and `once('click')` returning to the window.
 * Display copy arrives in each request from the client catalog; no conversation content crosses.
 */
export class DesktopSessionAttention {
  private readonly notifications = new Map<string, Notification>()

  /**
   * Surface one attention transition for a session, replacing its previous notification.
   * @param sessionId - Session whose transition needs attention; the click reports it back.
   * @param title - Session display name from the client catalog.
   * @param body - Kind line from the client catalog.
   * @param window - Taskbar window the click shows and focuses.
   * @param openSession - Reports the clicked session back to the renderer.
   */
  notify(sessionId: string, title: string, body: string, window: AttentionNotifyWindow, openSession: (sessionId: string) => void): void {
    this.clear(sessionId)
    if (!Notification.isSupported()) return
    try {
      const notification = new Notification({ title, body, silent: true })
      this.notifications.set(sessionId, notification)
      notification.on('failed', () => {
        // The system rejected the toast; the taskbar or dock marks stay as the fallback signal.
        if (this.notifications.get(sessionId) === notification) this.notifications.delete(sessionId)
        notification.removeAllListeners()
      })
      notification.once('click', () => {
        if (this.notifications.get(sessionId) !== notification) return
        this.clear(sessionId)
        if (!window.isDestroyed()) {
          if (window.isMinimized()) window.restore()
          window.show()
          window.focus()
        }
        openSession(sessionId)
      })
      notification.show()
    } catch (error) { console.warn('desktop session attention: notification unavailable', error) }
  }

  /** Release one session's owned notification. */
  clear(sessionId: string): void {
    const notification = this.notifications.get(sessionId)
    this.notifications.delete(sessionId)
    if (notification === undefined) return
    notification.removeAllListeners()
    try { notification.close() }
    catch (error) { console.warn('desktop session attention: could not close notification', error) }
  }

  /** Release every owned notification; the window keeps running without them. */
  dispose(): void {
    for (const sessionId of [...this.notifications.keys()]) this.clear(sessionId)
  }
}

/**
 * Mirror of the renderer's attention aggregate on the Windows taskbar overlay, the macOS dock
 * badge, and the window flash. One mark per surface, cleared as soon as the aggregate empties.
 */
export class DesktopAttentionChrome {
  private bounce: number | undefined

  /**
   * @param overlayIcon - Taskbar overlay bitmap; the window draws it, and `null` where the application ships none.
   * @param platform - Native attention implementation, replaceable for platform tests.
   */
  constructor(
    private readonly overlayIcon: () => unknown,
    private readonly platform: string = process.platform,
  ) {}

  /**
   * Apply one aggregate to the OS chrome.
   * @param state - complete current aggregate.
   * @param window - window carrying the taskbar marks.
   * @param description - accessible description of the overlay badge.
   */
  apply(state: DesktopAttentionState, window: AttentionChromeTarget, description: string): void {
    const approvals = state.sessions.filter(session => session.kind === 'approval').length
    try {
      if (this.platform === 'win32' && !window.isDestroyed()) {
        const icon = state.count === 0 ? null : this.overlayIcon()
        window.setOverlayIcon(icon, state.count === 0 ? '' : description)
        window.flashFrame(approvals > 0)
      }
      if (this.platform === 'darwin') {
        app.dock?.setBadge(state.count === 0 ? '' : String(state.count))
        this.bounceFor(approvals)
      }
    } catch (error) { console.warn('desktop session attention: taskbar marks unavailable', error) }
  }

  /** Clear every mark; the window keeps running without them. */
  dispose(window: AttentionChromeTarget | undefined): void {
    if (window !== undefined && !window.isDestroyed()) {
      try {
        window.setOverlayIcon(null, '')
        window.flashFrame(false)
      } catch (error) { console.warn('desktop session attention: could not clear taskbar marks', error) }
    }
    try {
      app.dock?.setBadge('')
      this.bounceFor(0)
    } catch (error) { console.warn('desktop session attention: could not clear dock marks', error) }
  }

  private bounceFor(approvals: number): void {
    if (this.platform !== 'darwin') return
    if (approvals > 0 && this.bounce === undefined) {
      this.bounce = app.dock?.bounce('critical')
      return
    }
    if (approvals === 0 && this.bounce !== undefined) {
      app.dock?.cancelBounce(this.bounce)
      this.bounce = undefined
    }
  }
}

/** Ambient targets the aggregate mirror writes to beyond the window itself. */
export interface DesktopAttentionTargets {
  /** Tray mirror; absent where the platform has no tray. */
  tray(): AttentionTrayTarget | undefined
  /**
   * Accessible description of the Windows overlay badge.
   * @param state - aggregate being applied.
   * @returns the localized description; empty when nothing needs attention.
   */
  describe(state: DesktopAttentionState): string
}

/**
 * Register the renderer-facing notify channel for background-session attention.
 * The request carries only display copy; a click reports the session id back over the click channel.
 * @param attention - the owned notification surface.
 * @param assertOwner - resolves the product window that owns the request.
 * @param suppressed - reports whether a shell-owned flow already owns the user's attention.
 * @returns a disposer removing the channel.
 */
export function installSessionAttention(
  attention: DesktopSessionAttention,
  assertOwner: (event: IpcMainInvokeEvent) => AttentionNotifyWindow,
  suppressed: () => boolean,
): () => void {
  ipcMain.handle(DESKTOP_IPC.sessionAttentionNotify, (event, request: unknown) => {
    const window = assertOwner(event)
    if (typeof request !== 'object' || request === null
      || typeof (request as { sessionId?: unknown }).sessionId !== 'string'
      || typeof (request as { title?: unknown }).title !== 'string'
      || typeof (request as { body?: unknown }).body !== 'string') {
      throw new Error('desktop session attention: invalid notify request')
    }
    // Shell-owned flows own the user's attention; the sidebar badge still records the transition.
    if (suppressed()) return
    const { sessionId, title, body } = request as { sessionId: string; title: string; body: string }
    attention.notify(sessionId, title, body, window, (clicked) => {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_IPC.sessionAttentionClick, clicked)
    })
  })
  return () => { ipcMain.removeHandler(DESKTOP_IPC.sessionAttentionNotify) }
}

/**
 * Register the aggregate channel that marks the taskbar, dock, and tray.
 * The renderer pushes the complete state, so the shell holds no session state of its own.
 * @param chrome - taskbar and dock marks for one aggregate.
 * @param targets - tray mirror and the localized overlay description.
 * @param assertOwner - resolves the product window that owns the request.
 * @param suppressed - reports whether a shell-owned flow already owns the user's attention.
 * @returns a disposer removing the channel and clearing the marks.
 */
export function installAttentionSummary(
  chrome: DesktopAttentionChrome,
  targets: DesktopAttentionTargets,
  assertOwner: (event: IpcMainInvokeEvent) => AttentionChromeTarget,
  suppressed: () => boolean,
): () => void {
  let marked: AttentionChromeTarget | undefined
  ipcMain.handle(DESKTOP_IPC.sessionAttentionState, (event, state: unknown) => {
    const window = assertOwner(event)
    const parsed = parseAttentionState(state)
    if (suppressed()) return
    marked = window
    chrome.apply(parsed, window, targets.describe(parsed))
    targets.tray()?.setAttention(parsed)
  })
  return () => {
    ipcMain.removeHandler(DESKTOP_IPC.sessionAttentionState)
    targets.tray()?.setAttention({ count: 0, sessions: [] })
    chrome.dispose(marked)
  }
}

/**
 * Validate one pushed aggregate at the process boundary.
 * @param state - untrusted value from the renderer.
 * @returns the aggregate as sent.
 */
function parseAttentionState(state: unknown): DesktopAttentionState {
  if (typeof state !== 'object' || state === null || typeof (state as { count?: unknown }).count !== 'number') {
    throw new Error('desktop session attention: invalid attention state')
  }
  const sessions = (state as { sessions?: unknown }).sessions
  if (!Array.isArray(sessions)) throw new Error('desktop session attention: invalid attention sessions')
  const parsed = sessions.map((session: unknown) => {
    if (typeof session !== 'object' || session === null) throw new Error('desktop session attention: invalid attention session')
    const value = session as { sessionId?: unknown; title?: unknown; kind?: unknown }
    if (typeof value.sessionId !== 'string' || typeof value.title !== 'string'
      || typeof value.kind !== 'string' || !ATTENTION_KINDS.includes(value.kind)) {
      throw new Error('desktop session attention: invalid attention session')
    }
    return { sessionId: value.sessionId, title: value.title, kind: value.kind as 'approval' | 'question' | 'completed' | 'failed' }
  })
  return { count: (state as { count: number }).count, sessions: parsed }
}

/** Overlay bitmaps for the taskbar badge and the idle icon they replace. */
export const ATTENTION_OVERLAY_SIZE = 16

/**
 * Build the Windows taskbar overlay badge from the application icon.
 * @param iconPath - source icon the shell already ships.
 * @returns the small bitmap, or `null` when the source cannot be read.
 */
export function overlayBadge(iconPath: string): Electron.NativeImage | null {
  const source = nativeImage.createFromPath(iconPath)
  if (source.isEmpty()) return null
  return source.resize({ width: ATTENTION_OVERLAY_SIZE, height: ATTENTION_OVERLAY_SIZE })
}
