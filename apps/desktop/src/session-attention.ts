/** Best-effort background session attention; a click only opens the session, never answers it. */
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent, Notification } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'

/**
 * Owns one live OS notification per session, closing the previous before showing the next.
 *
 * Mirrors `DesktopUpdateAttention`: `Notification.isSupported()` guard, failed-event cleanup,
 * silent degradation with one logged diagnostic, and `once('click')` returning to the window.
 * Display copy arrives in each request from the client catalog; no conversation content crosses.
 */
export class DesktopSessionAttention {
  private readonly notifications = new Map<string, Notification>()
  private readonly stops = new Map<string, () => void>()

  /**
   * @param platform - Native attention implementation, replaceable for platform tests.
   */
  constructor(private readonly platform: string = process.platform) {}

  /**
   * Surface one attention transition for a session, replacing its previous notification.
   * @param sessionId - Session whose transition needs attention; the click reports it back.
   * @param title - Session display name from the client catalog.
   * @param body - Kind line from the client catalog.
   * @param window - Taskbar window the click shows and focuses.
   * @param openSession - Reports the clicked session back to the renderer.
   */
  notify(sessionId: string, title: string, body: string, window: BrowserWindow, openSession: (sessionId: string) => void): void {
    this.clear(sessionId)
    if (!Notification.isSupported()) return
    let bounce: number | undefined
    const stop = (): void => {
      if (this.platform === 'win32' && !window.isDestroyed()) window.flashFrame(false)
      if (bounce !== undefined) app.dock?.cancelBounce(bounce)
    }
    this.stops.set(sessionId, stop)
    try {
      if (this.platform === 'win32') window.flashFrame(true)
      if (this.platform === 'darwin') bounce = app.dock?.bounce('informational')
    } catch (error) { console.warn('desktop session attention: unavailable', error) }
    try {
      const notification = new Notification({ title, body, silent: true })
      this.notifications.set(sessionId, notification)
      notification.on('failed', () => {
        // The system rejected the toast; the taskbar or dock attention stays as the fallback signal.
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

  /** Release one session's owned notification and taskbar attention. */
  clear(sessionId: string): void {
    const notification = this.notifications.get(sessionId)
    this.notifications.delete(sessionId)
    if (notification !== undefined) {
      notification.removeAllListeners()
      try { notification.close() }
      catch (error) { console.warn('desktop session attention: could not close notification', error) }
    }
    const stop = this.stops.get(sessionId)
    this.stops.delete(sessionId)
    try { stop?.() }
    catch (error) { console.warn('desktop session attention: could not clear taskbar attention', error) }
  }

  /** Release every owned notification; the window keeps running without them. */
  dispose(): void {
    for (const sessionId of [...this.notifications.keys()]) this.clear(sessionId)
  }
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
  assertOwner: (event: IpcMainInvokeEvent) => BrowserWindow,
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
