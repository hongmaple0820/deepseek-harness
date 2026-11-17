# Agent Note: 会话关注系统

Status: implemented

[English](2026-11-15-session-attention-system.md) | 中文

## Problem

会话结束一个回合或开始等待输入，是会话状态表已经知道、而外壳其余部分视而不见的事实。侧边栏角标是唯一的信号，它只会说「有东西需要读」，不说是什么、也不说是哪个会话。在场的读者需要在工作位置看到提示；离开的读者需要在操作系统自己的展示面上看到。一套策略无法同时服务两者：决定展示面的是在场状态，而不是事实本身。

触发事实在状态表中已经齐备（[session reading state](../../implemented/feature/2026-10-23-session-reading-memory.zh.md)）：每会话的 `completionUnread` 与 `completionFailed`、每会话的待处理交互，以及读者实际正在看的主视图会话。缺的是建立在这些事实之上的转换事件流，以及各自按在场条件消费它的展示面。

## Decision

### 触发

`SessionAttentionWatcher`（`packages/client/ui-session-status/src/client/attention.ts`）按转换发事件，且与展示面无关：它导出 `completed`、`failed`、`approval`、`question` 事件与会话 id，从不触碰任何展示面。每个消费方各自施加在场条件。

- 自然完成转为未读——非可见、聚焦主视图的会话满足 `completedTurn > readTurn`——发出 `completed`；回合以失败结束时发出 `failed`。手动未读标记永不发事件：那是读者亲手设置的。
- 非可见、聚焦主视图的会话出现待审批或待提问。委派审批永不发事件。
- 可见、聚焦主视图当前的会话本身永不发事件。
- 没有补发：发生在无人关心时的转换直接丢弃，不会稍后重放。

展示面按在场状态分工：应用内注意力栈服务在场的读者（页面可见且聚焦、会话不在主视图）；系统通知服务离开的读者（页面隐藏或窗口失焦）；任务栏、托盘与 Dock 承载聚合，不受在场条件限制，因为它们是被扫一眼就懂的。

### 应用内注意力栈

注意力栈是新的键控槽位 `workspace.attention`，与行内提示并列注册在 shell overlay 之下，卡片位于输入框卡片之上，左对齐、向上堆叠。没有复流行内提示：它是单槽位展示面、三秒即淡出，而关注提示需要排队、在审批未决时常驻、并且需要显式关闭。只有锚点测量被复用——注意力栈读取 `[data-composer-card]` 的矩形，并在窗口尺寸变化与输入框变动时重新测量。

- `installAttentionNotices`（`packages/client/ui-workspace/src/client/attention.ts`）拥有队列：每会话一条提示（新事件替换该会话上一条），最多三张卡片可见，其上是一条「另有 N 个会话需要关注」的溢出按钮，点击会展开侧边栏。
- 每张卡片显示名、类别行，审批卡片再加一行上下文——工具名与其展示理由——即审批面板在要求决定前给出的同一底线。查看操作经 `uiWorkspace.openSession` 打开会话。
- `completed` 与 `failed` 卡片在约八秒后由 `ATTENTION_HOLD_MS` 驱动的 CSS 动画淡出；`approval` 与 `question` 卡片永不自动消失。关闭卡片不会让它再次触发。

### 快速审批回复

审批卡片在「查看」旁带「允许」与「拒绝」。两者都对状态快照持有的 `PendingApproval` 实例调用 `answer()`——与审批面板回车、Esc 使用的同一对象与同一路径——因此回复结算的正是面板会结算的那个待处理请求。

- 上下文行是做出决定前的必要信息：不看工具与理由就回答审批等于掷硬币。
- 查看是主操作；允许与拒绝是次要操作。
- 委派审批只显示查看，因为需要回答的人不是当前读者。
- 提问永不提供快速回复：带推荐项的结构化选择无法代替读者作答。
- 回复成功即消解卡片；失败则卡片转为错误状态，「查看」仍然可用。

### 任务栏、托盘与 Dock

渲染进程计算聚合——有待处理交互或自然完成未读的会话，排除手动标记，各带标题与类别——并在变化时通过类型化 `dshDesktop.attention` 通道推送。没有任何轮询。

- Windows：由应用图标缩放而来的任务栏叠加角标，外加窗口闪烁；只在有待审批时闪烁。
- macOS：Dock 角标计数，外加 critical 弹跳；只在有待审批时弹跳。
- 其它平台：平台支持就显示角标，否则静默降级。
- 托盘：计数为正时出现「需要关注的会话」区段，最多五行，每行经系统通知相同的点击路径打开其会话；另有注意力图标变体与携带计数的 tooltip，归零时都回落。
- 托盘不提供快速回复：菜单项一点即关，且无法携带决定所需的上下文行。

### 设置

通用设置页一个三开关组，全部默认开启，位于 `ui-workspace` 设置命名空间：应用内关注提示、系统通知、任务栏/托盘标记。每个展示面在行动前读自己的开关。浏览器标签页中两个系统开关隐藏，因为那里没有桌面桥接。三者都放在客户端 Cordis 设置里，外壳不加自己的设置，遵守 [shell configuration](../../implemented/architecture/2026-10-08-desktop-shell-configuration.zh.md) 的归属规则。

### 与既有笔记的关系

[后台会话的桌面通知](2026-11-15-desktop-notifications-for-background-sessions.zh.md) 拥有系统通知面，其监视器是本笔记泛化的共享核心；那里的触发策略不变。[Session reading state](../../implemented/feature/2026-10-23-session-reading-memory.zh.md) 拥有未读记录及其确认。[Close-to-background](../../implemented/architecture/2026-09-23-desktop-close-to-background-and-quit-confirmation.zh.md) 的规则不变：关闭窗口不发通知。[Shell configuration](../../implemented/architecture/2026-10-08-desktop-shell-configuration.zh.md) 保留设置归属。

## Alternatives considered

**用行内提示承载关注提示。** 行内提示是三秒即走的单槽位展示面，为「会话 id 已复制」这类场景而设。关注提示需要排队、在审批未决时常驻、并且需要关闭按钮；勉强复用会同时损害两者。

**不看在场状态一律弹应用内提示。** 正在看该会话的读者不需要关于它的卡片；窗口隐藏时弹出的卡片在被读之前就消失了。在场状态决定展示面。

**回到应用时补发提示。** 事后重放转换，等于把系统通知已经宣告过的信息再说一遍，而未读角标仍然在说同一件事。不补发。

**托盘菜单里做快速回复。** 菜单项一点即关，带不了上下文行；从菜单回答审批等于盲答。

**为提问提供快速回复。** 提问带推荐项与结构化选项；二元回复只能替读者选择或伪造答案。

**在 Host 侧做监视器。** 未读、在场与主视图事实都在客户端；Host 侧监视器会复制策略，并为没有任何前端在显示的会话发通知。

**只做角标，不做注意力栈。** 角标只说有事发生，从不说是什么；读者必须打开应用才知道，而这正是本笔记要解决的起点问题。

## Consequences

每个展示面都在自己的在场条件与自己的开关之后落地：应用内注意力栈经 `workspace.attention`，系统通知经 `dshDesktop.notifications`，聚合经 `dshDesktop.attention`。`apps/desktop/src/session-attention.ts` 中的 `DesktopAttentionChrome` 拥有任务栏与 Dock 标记，`DesktopTray.setAttention` 拥有托盘区段与图标变体，ui-workspace 的测试覆盖队列、卡片、快速回复、设置组与聚合发布。

- 并行爆发受「每会话替换」与三张卡片上限约束；聚合计数仍会报出每一个会话。
- 快速审批降低决定摩擦，这正是上下文行、查看优先、委派排除与设置开关都保留的原因。
- 渲染进程是触发源：窗口隐藏时页面崩溃或重载会让应用内与系统关注静默停止，而 Host 继续运行；这是把策略留在同一处的可接受代价。
- 平台角标投递差异（任务栏叠加支持、Dock 角标可见性、托盘 tooltip 长度）会静默降级；验证按平台覆盖真实序列。
- 注意力栈是第二个类提示展示面。槽位边界让两者互不影响：行内提示保持单槽位替换，注意力栈保持自己的队列。
