/** Type-only Electron bridge declarations shared by the desktop shell and the session-attention consumer. */

/** One attention transition the renderer asks the shell to surface as an OS notification. */
export interface DesktopSessionAttentionRequest {
  /** Session whose transition needs attention; the click returns here. */
  readonly sessionId: string
  /** Session display name; the client catalog owns the copy. */
  readonly title: string
  /** Kind line (completed/failed/waiting for approval/waiting for question); no conversation content. */
  readonly body: string
}

/**
 * Origin-scoped OS-notification surface; no Electron objects or arbitrary IPC cross this interface.
 *
 * The shell keeps one live notification per session and closes the previous one before showing the
 * next; a click shows and focuses the window and reports the session back through `subscribe`.
 */
export interface DesktopSessionNotifications {
  /**
   * Ask the shell to surface one attention transition.
   * @param request - display copy plus the session to open on click.
   * @returns after the shell accepted (or silently declined) the request.
   */
  notify(this: void, request: DesktopSessionAttentionRequest): Promise<void>
  /**
   * Observe notification clicks.
   * @param listener - receives the session id whose notification was clicked.
   * @returns unsubscribe.
   */
  subscribe(this: void, listener: (sessionId: string) => void): () => void
}
