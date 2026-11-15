# Agent Note: Desktop notifications for background sessions

Status: proposed

English | [中文](2026-11-15-desktop-notifications-for-background-sessions.zh.md)

## Problem

The Desktop shell keeps working when the user looks away: closing the window hides it while the Host and the page keep running ([close-to-background](../../implemented/architecture/2026-09-23-desktop-close-to-background-and-quit-confirmation.md)), and long turns routinely finish while the window is hidden or unfocused. A session that completes, fails, or starts waiting for an approval or question then has no signal outside the application. The status table marks the row unread, but the user must raise the window and read the table to learn that the background work finished; the practical alternative is polling the window for the whole duration of every long task.

Every trigger fact already exists client-side. The session-status table derives `completionUnread` and `completionFailed` from the Host reading stream, pending interactions are tracked per session, and the client already watches page visibility and window focus to decide when reading counts as acknowledged ([session reading state](../../implemented/feature/2026-10-23-session-reading-memory.md)). What is missing is a bridge from those facts to the operating system.

## Proposal

### Trigger

A client-side attention watcher emits one event per transition, not per state:

- A session's natural completion unread — `completedTurn > readTurn` for a session that is not the visible, focused main view — turns true; the turn completed or failed. Manual unread marks never notify: the user set them from inside the application.
- A session that is not the visible, focused main view gains a pending approval or question.

Events fire only when the page is hidden or the window is unfocused at the moment of the transition — the same `document.visibilityState === 'visible' && document.hasFocus()` signal the reading acknowledgement uses. While the user is present at the application, the in-app status table is the surface and an OS toast would be redundant; a transition that happens while present never notifies later, even if the user then walks away. The watcher lives with the status facts in the ui-session-status client face and exports the event stream; it imports no Electron global. A session that completes again (a new ended turn) notifies again; Electron notifications carry no replacement tag, so the shell keeps one live notification per session and closes the previous one before showing the next — the per-target bookkeeping the update reminder already uses.

### Desktop bridge

The renderer forwards each event through a new typed `dshDesktop.notifications` operation, following the existing `dshDesktop` capability pattern (typed channel names in `apps/desktop/src/ipc.ts`, exposed by the app preload for the main app frame only). The consumer lives in the ui-workspace client face, which already reads the status snapshot and owns session opening; the watcher stays free of Electron globals. Electron main owns the `Notification` object and follows the shell's existing update reminder (`apps/desktop/src/update-attention.ts`): the same `Notification.isSupported()` guard, failed-event cleanup, silent degradation with one logged diagnostic, and `once('click')` handling.

- it shows the toast with the session's display name and a kind line — completed, failed, waiting for approval, waiting for question — with copy from the client i18n catalog carried in the request; no conversation content, because the OS notification surface outlives the app and is visible on lock screens and in notification-center history;
- on click it shows and focuses the window and forwards the session id to the renderer, which opens that session in the main view through `uiWorkspace.openSession`, the same path the session list uses; opening then clears the unread through the existing automatic acknowledgement;
- it suppresses notifications during quit confirmation, mandatory-update overlays, and similar shell-owned flows, and may pair the toast with the taskbar flash and dock bounce the update reminder already uses.

### Settings

One client toggle — background session notifications, on by default — read by the bridge consumer before it forwards anything, declared like the chat preferences: a config-forms namespace with a `settings.general.item` slot. The toggle lives in client Cordis settings because the trigger lives in the client; the shell adds no setting of its own, keeping the [shell configuration](../../implemented/architecture/2026-10-08-desktop-shell-configuration.md) ownership rule. In a browser tab the toggle is hidden until a Web Notification adapter exists; the attention-event stream is surface-agnostic, so that adapter can follow without touching the trigger policy.

### Relationship to existing notes

[Session reading state](../../implemented/feature/2026-10-23-session-reading-memory.md) owns the unread records and their acknowledgement; this proposal consumes its stream and supersedes none of it. Its deferred visibility refinement — distinguishing settings or auxiliary panels from the main view — stays deferred: the watcher uses the same whole-page visibility signal. [Close-to-background](../../implemented/architecture/2026-09-23-desktop-close-to-background-and-quit-confirmation.md) keeps its rule that closing the window itself sends no notification; this proposal notifies on session transitions, not on window events. The watcher this note defines is proposed as the shared core of the [session attention system](2026-11-15-session-attention-system.md), which adds the in-app attention stack and the taskbar/tray surfaces; this note keeps the OS-notification surface and its presence condition.

## Alternatives considered

**Notify from the Host or Electron main by watching session state.** The unread, viewing, and focus semantics live in the client; duplicating them in the shell means a second authority for the same policy and a second settings path. The client already computes every trigger fact.

**HTML5 Notification API in the renderer.** Electron supports it, but raising a hidden window on click needs main-process help anyway, permission behavior differs across platforms and Electron versions, and the shell could not suppress notifications during update or quit flows. The typed IPC bridge matches every other desktop capability.

**Notify per unread state instead of per transition.** Steady-state evaluation re-fires on every snapshot or needs its own dedup bookkeeping; the transition is the natural unit — one toast per completion.

**Browser Web Notifications in the same change.** A different permission flow (explicit browser prompt) and a different presence signal (tab visibility); deferred so the Desktop path can validate the trigger policy first. The seam keeps it additive.

**Shell-owned notification copy.** The desktop shell already carries eight-locale copy for its update reminder, synced from the client locale. Kind copy could live there; carrying it in the request keeps one source of truth in the client catalog and avoids duplicating wording the client already owns.

**Tray or taskbar badge instead of a toast.** Less intrusive but carries no session identity and no click-to-open target; the Windows tray already exists. A possible complement, not the primary channel.

**Include the last message in the body.** More informative, but leaks conversation content onto the lock screen and into notification history. Name and kind only.

## Acceptance criteria

- A turn that completes or fails in a session that is not the visible, focused main view, while the page is hidden or the window unfocused, produces exactly one OS notification; the same ended turn never notifies twice, and manual unread marks never notify.
- A pending approval or question appearing for such a session produces a notification with distinct copy.
- No notification fires while the page is visible and focused, and none for the session currently open in the visible main view.
- Clicking the notification shows and focuses the window and opens that session in the main view; the existing automatic acknowledgement then clears the unread as before.
- The toggle off produces no bridge traffic; OS-level notification failure degrades silently with one logged diagnostic.
- Browser behavior is unchanged.

## Risks

- Platform delivery differs: Windows toast activation depends on the app identity, focus-assist can swallow toasts, macOS notification-center settings apply, and Linux depends on a notification daemon. Like the tray work, this needs a manual pass per platform.
- Parallel sessions can still produce a burst of toasts; per-session tag replacement caps stacking, but a quiet-period policy may be needed after real use.
- The renderer is the trigger source: a page that crashes or reloads while the window is hidden stops notifications silently while the Host keeps running. Accepted; the Host-side path is the rejected heavier alternative.
- `document.hasFocus()` edge cases (occluded-but-focused windows) can misclassify presence on some platforms; verification covers the real sequences.
