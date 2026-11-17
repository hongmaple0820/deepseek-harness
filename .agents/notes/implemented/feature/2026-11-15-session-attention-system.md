# Agent Note: Session attention system

Status: implemented

English | [中文](2026-11-15-session-attention-system.zh.md)

## Problem

A session that finishes a turn or starts waiting for input is a fact the session status table knows and the rest of the shell ignores. The sidebar badge is the only signal, and it says "something needs reading" without saying what or which session. The reader who is present in the application needs the notice where they are working; the reader who stepped away needs it on the operating system's own surfaces. One policy cannot serve both: presence, not the fact, decides the surface.

The trigger facts already exist in the status table ([session reading state](../../implemented/feature/2026-10-23-session-reading-memory.md)): `completionUnread` and `completionFailed` per session, pending interactions per session, and the main-view session the reader is actually looking at. What is missing is a transition stream over those facts and the surfaces that consume it under their own presence condition.

## Decision

### Trigger

`SessionAttentionWatcher` (`packages/client/ui-session-status/src/client/attention.ts`) emits one event per transition and stays surface-agnostic: it exports `completed`, `failed`, `approval`, and `question` events with a session id, and never touches a surface. Every consumer applies its own presence condition.

- A natural completion turns unread — `completedTurn > readTurn` for a session that is not the visible, focused main view — emits `completed`, or `failed` when the turn ended in failure. Manual unread marks never emit: the reader set them by hand.
- A session that is not the visible, focused main view gains a pending approval or question. Delegated approvals never emit.
- The visible, focused main view's own session never emits.
- There is no catch-up: a transition that happens while no surface was interested is dropped, not replayed later.

Surfaces split by presence: the in-app stack serves the reader who is present (page visible and focused, session not in the main view); the OS notification serves the reader who is away (page hidden or window unfocused); the taskbar, tray, and dock carry the aggregate with no presence condition at all, because they are read at a glance.

### In-app attention stack

The stack is a new keyed slot `workspace.attention` registered beside the row toast under the shell overlay, with the cards above the composer card, left-aligned and stacking upward. The row toast is not reused: it is a single-slot surface that fades in three seconds, while attention notices queue, stay resident for approvals, and need explicit dismissal. Only the anchor measurement is shared — the stack reads the `[data-composer-card]` rect and re-measures on resize and on composer changes.

- `installAttentionNotices` (`packages/client/ui-workspace/src/client/attention.ts`) owns the queue: one notice per session (a new event replaces the previous notice for that session), at most three cards visible, and an overflow row above them reading "N more sessions need attention" that expands the sidebar.
- Each card shows the display name, the kind line, and — for an approval — one context line with the tool name and its display reason, the same floor the approval panel gives before it asks for a decision. The View action opens the session through `uiWorkspace.openSession`.
- `completed` and `failed` cards fade after about eight seconds through a CSS animation driven by `ATTENTION_HOLD_MS`; `approval` and `question` cards never auto-dismiss. Dismissing a card does not re-fire it.

### Quick approval replies

An approval card carries Allow and Deny beside View. Both call `answer()` on the `PendingApproval` instance the status snapshot holds — the same object and the same path the approval panel's Enter and Escape use — so the reply settles exactly the pending request the panel would settle.

- The context line is mandatory before the decision: an approval answered without its tool and reason is a coin flip.
- View is the primary action; Allow and Deny are secondary.
- Delegated approvals show View only, because the reader is not the one who must answer.
- Questions never get quick replies: a structured choice with recommendations cannot be answered on the reader's behalf.
- A successful reply dissolves the card; a failed one turns the card into an error state with View still available.

### Taskbar, tray, and dock

The renderer computes the aggregate — sessions with a pending interaction or a natural completion unread, manual marks excluded, each with a title and kind — and pushes it over the typed `dshDesktop.attention` channel whenever it changes. There is no polling.

- Windows: a taskbar overlay badge sized from the app icon plus a frame flash, the flash only while an approval is pending.
- macOS: the Dock badge count plus a critical bounce, the bounce only while an approval is pending.
- Other platforms: a badge where the platform supports one, and silent degradation otherwise.
- Tray: a "sessions needing attention" section with up to five rows when the count is positive, each row opening its session through the same click path the OS notification uses; an attention icon variant and a tooltip carrying the count, both reverting at zero.
- The tray offers no quick replies: a menu item dismisses on click and cannot carry the context line a decision needs.

### Settings

One General-page group with three toggles, all on by default, in the `ui-workspace` settings namespace: in-app attention notices, system notifications, and taskbar/tray marks. Each surface reads its own toggle before acting. The two OS toggles are hidden in a browser tab, where no desktop bridge exists. All three live in client Cordis settings so the shell adds no setting of its own, following the [shell configuration](../../implemented/architecture/2026-10-08-desktop-shell-configuration.md) ownership rule.

### Relationship to existing notes

[Desktop notifications for background sessions](2026-11-15-desktop-notifications-for-background-sessions.md) owns the OS notification surface and its watcher is the shared core this note generalizes; the trigger policy there is unchanged. [Session reading state](../../implemented/feature/2026-10-23-session-reading-memory.md) owns the unread records and their acknowledgement. [Close-to-background](../../implemented/architecture/2026-09-23-desktop-close-to-background-and-quit-confirmation.md) keeps its rule that closing the window sends no notification. [Shell configuration](../../implemented/architecture/2026-10-08-desktop-shell-configuration.md) keeps settings ownership.

## Alternatives considered

**Reuse the row toast for attention notices.** The toast is a single-slot surface with a three-second hold, sized for "your session id was copied". Attention notices queue, stay resident while an approval is pending, and need a close button; bending the toast would have made both worse.

**Fire in-app notices regardless of presence.** A reader who is looking at the session does not need a card about it, and a card raised while the window is hidden is gone before it is read. Presence decides the surface.

**Catch-up notices on return.** Replaying transitions after the fact tells the reader about work the OS surface already announced, and the unread badge still says it. No catch-up.

**Quick replies in the tray menu.** A menu item dismisses on click and carries no context line; answering an approval from a menu is answering blind.

**Quick replies for questions.** A question carries recommendations and a structured choice; a binary reply would either choose for the reader or fabricate an answer.

**A Host-side watcher.** The unread, presence, and main-view facts are client-side; a Host watcher would duplicate the policy and ship notifications for sessions no client is showing.

**Badge only, no stack.** A badge says something happened, never what; the reader has to open the application to find out, which is the problem this note starts from.

## Consequences

Every surface ships behind its own presence condition and its own toggle: the in-app stack through `workspace.attention`, the OS notification through `dshDesktop.notifications`, the aggregate through `dshDesktop.attention`. `DesktopAttentionChrome` in `apps/desktop/src/session-attention.ts` owns the taskbar and Dock marks, `DesktopTray.setAttention` owns the tray section and icon variant, and ui-workspace tests cover the queue, the cards, the quick replies, the settings group, and the aggregate publication.

- Parallel bursts stay bounded by per-session replacement and the three-card limit; the aggregate count still reports every session.
- Quick approvals lower the friction of a decision, which is why the context line, View-first ordering, the delegation exclusion, and the settings gate all stay.
- The renderer is the trigger source: a page that crashes or reloads while hidden stops in-app and OS attention while the Host keeps running, which is the accepted cost of keeping the policy in one place.
- Platform badge delivery differs (taskbar overlay support, Dock badge visibility, tray tooltip length) and degrades silently; verification covers the real sequences per platform.
- The stack is a second toast-like surface. The slot boundary keeps the two independent: the row toast keeps single-slot replacement, the stack keeps its queue.
