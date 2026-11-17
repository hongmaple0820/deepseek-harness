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

/** One session the renderer counts as needing attention. */
export interface DesktopAttentionSession {
  /** Session the shell opens when its tray row is chosen. */
  readonly sessionId: string
  /** Session display name; the client catalog owns the copy. */
  readonly title: string
  /** Why the session needs attention; approvals additionally drive the taskbar and dock attention marks. */
  readonly kind: 'approval' | 'question' | 'completed' | 'failed'
}

/** Aggregate the renderer owns and the shell mirrors onto the taskbar, dock, and tray. */
export interface DesktopAttentionState {
  /** Number of sessions needing attention; zero clears every OS mark. */
  readonly count: number
  /** At most one entry per session, newest last. */
  readonly sessions: readonly DesktopAttentionSession[]
}

/**
 * Origin-scoped taskbar, dock, and tray surface; the renderer computes the aggregate and pushes it
 * on change, so the shell never polls session state and never reads conversation content.
 */
export interface DesktopAttentionSummary {
  /**
   * Publish the current aggregate.
   * @param state - complete current aggregate, not a delta.
   * @returns after the shell accepted the state.
   */
  update(this: void, state: DesktopAttentionState): Promise<void>
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
