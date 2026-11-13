---
kind: upgrade-guide
description: The sidebar viewport stops supplying the section scroller hook and its scroll handoff.
---

# Remove the sidebar section scroller

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-client-ui-sidebar` no longer exports `SectionScroller`, `UseSectionScroller`, `SidebarSectionHookContext`, or `SidebarSectionInjected`. The `sidebar.workspaces` entry is now a plain root single-value slot: it no longer injects a `hooks.sectionScroller` factory, and the viewport no longer passes a `hookContext` to the occupant.

The sidebar viewport also stops being a scroll-state container. Panel navigation rows scroll inside their own capped list instead of being carried away by the viewport, so the wheel handoff that let the occupant's list win the remaining delta has nothing left to coordinate. A registrant that declared `hooks.sectionScroller` or bound `useSectionScroller().bindScrollerRef` no longer receives the hook; its list keeps its ordinary scrolling and the viewport keeps scrolling the whole sidebar when navigation plus workspace rows still overflow.

## Migration

1. Remove the `hooks: { sectionScroller }` field from the `sidebar.workspaces` registration.
2. Delete the `bindScrollerRef` binding, and any `useSectionScroller` call or `SidebarSectionHookContext` read, from the occupant component.
3. Delete imports of the four removed types from `@deepseek-ai/dsh-client-ui-sidebar`; keep the occupant's own scroll container and its CSS.
4. Confirm with `pnpm run typecheck`, then scroll the sidebar until both the panel navigation and the workspace rows overflow: the navigation rows scroll in place and the viewport scrolls the workspace rows.
