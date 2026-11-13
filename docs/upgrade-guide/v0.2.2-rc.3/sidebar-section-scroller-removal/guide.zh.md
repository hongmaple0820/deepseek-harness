---
kind: upgrade-guide
description: 侧栏视口不再提供区块滚动钩子及其滚动交接。
---

# 移除侧栏区块滚动器

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-client-ui-sidebar` 不再导出 `SectionScroller`、`UseSectionScroller`、`SidebarSectionHookContext` 和 `SidebarSectionInjected`。`sidebar.workspaces` 条目现在是普通的 root 单值槽位：不再注入 `hooks.sectionScroller` 工厂，视口也不再向占位组件传递 `hookContext`。

侧栏视口同时不再是 scroll-state 容器。面板导航行在自身上限列表内滚动，不再被视口带走，因此让占位组件列表接收剩余滚动量的滚轮交接已无协调对象。声明了 `hooks.sectionScroller` 或绑定 `useSectionScroller().bindScrollerRef` 的注册方不再收到该钩子；其列表维持普通滚动，当导航与工作区行仍溢出时视口继续滚动整个侧栏。

## 迁移

1. 从 `sidebar.workspaces` 注册中删除 `hooks: { sectionScroller }` 字段。
2. 从占位组件中删除 `bindScrollerRef` 绑定，以及任何 `useSectionScroller` 调用或 `SidebarSectionHookContext` 读取。
3. 删除从 `@deepseek-ai/dsh-client-ui-sidebar` 导入的四个已移除类型；保留占位组件自己的滚动容器及其 CSS。
4. 用 `pnpm run typecheck` 确认，然后滚动侧栏直到面板导航与工作区行同时溢出：导航行原地滚动，视口滚动工作区行。
