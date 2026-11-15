# Agent Note: Session attention system

Status: proposed

English | [中文](2026-11-15-session-attention-system.zh.md)

## Problem

The session status table is a passive surface: a session that completes, fails, or starts waiting for an approval or question is marked on its sidebar row, and learning about it requires looking there. While the user is present in the application and working in another session, that badge is the entire signal — nothing arrives where the user's attention actually is, next to the composer they are typing into. When the user is away, the [desktop notifications proposal](2026-11-15-desktop-notifications-for-background-sessions.md) reaches the operating system, but presence in the app and absence from it need different surfaces, and the taskbar and tray carry no aggregate state at all today.

Every trigger fact already exists client-side in the session-status table: running state, the effective pending interaction, natural completion unread, and failure ([session reading state](../../implemented/feature/2026-10-23-session-reading-memory.md)). What is missing is a transition event stream derived from that table, and surfaces that consume it under their own presence conditions.

## Proposal

### Trigger

A client-side attention watcher in the ui-session-status client face subscribes to the status table and emits one event per transition, never per state: a session's natural completion unread turning true emits `completed` or `failed`, and a session gaining a pending approval or question emits `approval` or `question`. The trigger rules are the ones the [desktop notifications proposal](2026-11-15-desktop-notifications-for-background-sessions.md) already states: manual unread marks never notify, the visible focused main view's session never notifies, and delegation approvals are excluded by the approval contract. The watcher is surface-agnostic — it imports no Electron global and knows no UI — and each consumer applies its own presence condition. That proposal's watcher becomes this shared core, unchanged in policy.

Presence splits by surface. The in-app stack fires only when the page is visible and focused and the session is not the main view: the user is present, so the OS toast stays silent. The OS notification fires only when the page is hidden or the window unfocused, exactly as its note states. The taskbar and tray surfaces aggregate state with no presence condition, because badges and counts are ambient rather than interruptions. No catch-up exists: a transition that happens while the user is away never re-fires as an in-app notice on return — the sidebar badge is the catch-up surface, and the OS notification already covered the absence.

### In-app attention stack

A new keyed slot `workspace.attention`, registered beside the row toast under the shell overlay, renders a stack of notice cards anchored above the composer card, left-aligned with it and stacking upward. The row toast is not reused: it is a single-slot transient — a new toast replaces the previous one and fades after three seconds — while attention notices queue across sessions, must stay resident while an approval waits, and need manual dismissal; the two semantics would corrupt each other. The Toast primitive's anchor measurement is reused, as the message-feedback toasts already anchor to the composer card.

The stack keeps one notice per session — a new event replaces that session's notice — with at most three visible cards and an overflow row reading "N more sessions need attention" that focuses the sidebar. A card shows the session's display name, a kind line — completed, failed, waiting for approval, waiting for question — and, for approvals, one context line with the tool name and display reason, the same information floor as the approval panel. Every card carries a View action that opens the session through `uiWorkspace.openSession`, the same path the session list uses, after which the existing automatic acknowledgement clears the unread. Completed and failed cards fade after about eight seconds; approval and question cards never auto-dismiss. Dismissing a card with its close button does not re-fire the same event.

### Quick approval replies

Approval cards add Allow and Deny actions that call `answer()` on the `PendingApproval` instance carried in the status snapshot — the same object and code path the approval panel's Enter and Esc use; no new approval channel exists and delegation semantics are untouched. The guardrails: the context line is mandatory, View stays the primary action, delegation approvals are excluded, and questions never offer a quick reply — a structured choice with recommended options cannot be answered by picking one on the user's behalf. A successful answer dissolves the card; a failed one turns it into an error state that keeps View. The accepted tradeoff is that one context line is narrower than the full approval panel: `allowed-once` is a scoped grant, View remains the default, and a settings gate for quick replies is the fallback if real use shows mistakes.

### Taskbar, tray, and dock

The renderer computes an aggregate — the count of sessions with a pending interaction or natural completion unread, manual marks excluded, plus each such session's title and kind — and pushes it over a new typed `dshDesktop.attention` channel whenever it changes; no polling exists. Windows shows a taskbar overlay badge and flashes the frame only for approval events; macOS sets the dock badge count and bounces critically only for approvals; Linux sets the badge count where the launcher supports it and degrades silently elsewhere. The tray menu gains a "sessions needing attention" section of at most five rows when the count is above zero, each row opening its session through the exact OS-notification click path: show and focus the window, forward the session id, open it in the main view. The tray icon renders an attention variant and the tooltip appends the count, reverting when the count returns to zero. The tray menu offers no quick replies: a menu item dismisses on click and cannot carry context, so jumping is its only action.

### Settings

One settings group in the General page — in-app attention notices, system notifications, and taskbar/tray marks, each on by default — declared like the chat preferences: a config-forms namespace with `settings.general.item` slots. The system-notification and taskbar toggles are hidden in a browser tab. All three live in client Cordis settings because every trigger and consumer lives in the client; the shell adds no setting of its own, keeping the [shell configuration](../../implemented/architecture/2026-10-08-desktop-shell-configuration.md) ownership rule.

### Relationship to existing notes

The [desktop notifications proposal](2026-11-15-desktop-notifications-for-background-sessions.md) owns the OS-notification surface; its watcher is upgraded to the shared core defined here, and its trigger policy is unchanged. [Session reading state](../../implemented/feature/2026-10-23-session-reading-memory.md) owns the unread records and their acknowledgement; this proposal consumes its stream and supersedes none of it. [Close-to-background](../../implemented/architecture/2026-09-23-desktop-close-to-background-and-quit-confirmation.md) keeps its rule that closing the window itself sends no notification. [Shell configuration](../../implemented/architecture/2026-10-08-desktop-shell-configuration.md) keeps the settings ownership boundary.

## Alternatives considered

**Reuse the row toast for in-app notices.** The row toast is a single-slot transient that replaces its predecessor and auto-fades in three seconds; attention notices queue across sessions, stay resident while an approval waits, and need manual dismissal. Sharing the slot would break both surfaces, so the stack is a sibling slot reusing only the anchor measurement.

**Fire in-app notices regardless of presence.** While the user is away an in-app notice is invisible until return and duplicates the OS notification that already fired; while the user is present an OS toast is redundant noise. The presence split gives each surface the condition under which it is the single signal.

**Catch-up notices on return.** Replaying missed transitions when the window regains focus produces a burst of stale cards on every open; the sidebar badge already carries the missed state, and the OS notification covered the absence. No catch-up.

**Quick replies in the tray menu.** A menu item dismisses on click and cannot carry the context line that makes a quick reply safe; the tray section jumps to the session instead.

**Quick replies for questions.** A pending question is a structured choice with recommended options; auto-picking one answers for the user. Questions offer View only.

**Host-side watcher.** The unread, viewing, and focus semantics live in the client; a Host-side watcher duplicates the policy and adds a second settings path. Rejected for the same reasons as in the desktop notifications proposal.

**Badge-only without an in-app stack.** Badges are passive; a user present in the app and focused on another session still gets nothing at their point of attention. The stack is the surface that reaches them.

## Acceptance criteria

- One event fires per transition; the same ended turn never notifies twice; manual unread marks, the visible focused main view's session, and delegation approvals produce zero events.
- A completion while the page is visible and focused produces an in-app notice and no OS notification; the same completion while hidden produces an OS notification and no in-app notice on return.
- Three sessions completing in sequence stack three cards in order; a fourth produces the overflow row; an approval card never auto-dismisses; View opens the session and the unread clears through the existing acknowledgement; dismissing a card does not re-fire the same event.
- A quick approval dissolves the card, calls `answer()` exactly once, and resolves an open approval panel in sync; delegation approvals and questions show View only.
- The taskbar and dock badge count equals the count of sessions with a pending interaction or natural completion unread, manual marks excluded; a tray row click opens its session through the same path as an OS notification click; the count returning to zero removes the badge and restores the tray icon.

## Risks

- Parallel sessions can burst: per-session notice replacement caps the stack at one card per session, the three-card limit plus overflow row bounds the visual cost, and a quiet-period policy stays deferred until real use.
- Quick approvals lower the friction of allowing a tool: the context line, View-first ordering, and the delegation exclusion are the guardrails, and a settings gate is the prepared fallback if mistakes appear.
- The renderer is the trigger source: a page that crashes or reloads stops all attention while the Host keeps running. Accepted, the same tradeoff as the desktop notifications proposal.
- Platform badge delivery differs — Windows overlay rendering, macOS dock settings, Linux launcher support — and degrades silently; like the tray and notification work, this needs a manual pass per platform.
- The stack adds a second toast surface beside the row toast; the slot boundary is the seam, and the row toast's behavior stays untouched.
