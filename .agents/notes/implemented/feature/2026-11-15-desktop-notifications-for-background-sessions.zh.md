# Agent Note: 后台会话的桌面通知

Status: implemented

[English](2026-11-15-desktop-notifications-for-background-sessions.md) | 中文

## Problem

桌面外壳在用户移开视线时仍在工作：关闭窗口只是隐藏它，Host 与页面继续运行（[close-to-background](../../implemented/architecture/2026-09-23-desktop-close-to-background-and-quit-confirmation.zh.md)），而长回合经常在窗口隐藏或失焦时结束。一个会话完成、失败，或开始等待审批/提问时，应用之外没有任何信号。状态表会把该行标为未读，但用户必须抬起窗口、读表才能知道后台工作结束了；现实中的替代做法是在每个长任务期间反复查看窗口。

触发所需的全部事实都已在客户端存在：会话状态表从 Host 的阅读流推导 `completionUnread` 与 `completionFailed`，待处理交互按会话跟踪，客户端也已经在监听页面可见性与窗口焦点来判定阅读何时算已确认（[session reading state](../../implemented/feature/2026-10-23-session-reading-memory.zh.md)）。缺的只是把这些事实桥接到操作系统。

## Decision

### 触发

客户端的注意力监视器按「转换」而非「状态」发事件，每次转换一个事件。`SessionAttentionWatcher` 与状态事实同住在 ui-session-status 客户端面，导出事件流；它不导入任何 Electron 全局。

- 某会话的自然完成未读——非可见、聚焦主视图的会话满足 `completedTurn > readTurn`——由假变真；回合完成或失败。手动未读标记永不通知：那是用户在应用内亲手设置的。
- 非可见、聚焦主视图的会话出现待审批或待提问。委派审批永不通知，因为需要回答的人不是当前用户。

事件只在转换发生那一刻页面隐藏或窗口失焦时发出——与阅读确认使用的同一条 `document.visibilityState === 'visible' && document.hasFocus()` 信号。用户在应用前时，应用内注意力栈就是展示面，系统通知是冗余；在场时发生的转换之后也不会补发，即使用户随后离开。会话再次完成（新的结束回合）会再次通知；Electron 通知没有替换用的 tag，因此外壳按会话保存一条存活通知，展示下一条前先关闭上一条——与更新提醒按目标做的簿记相同。

### 桌面桥接

渲染进程通过 `dshDesktop.notifications` 转发每个事件，沿用现有 `dshDesktop` 能力模式：`apps/desktop/src/ipc.ts` 中的类型化通道名（`dsh-desktop:session-attention-notify`、`dsh-desktop:session-attention-click`），仅由主应用帧的应用 preload 暴露。消费方是 `packages/client/ui-workspace/src/client/desktop-attention.ts`——它已经在读状态快照并拥有会话打开；监视器不碰任何 Electron 全局。Electron 主进程在 `apps/desktop/src/session-attention.ts`（`DesktopSessionAttention`，由 `installSessionAttention` 安装）持有 `Notification` 对象，并沿用外壳既有的更新提醒（`apps/desktop/src/update-attention.ts`）：同样的 `Notification.isSupported()` 守卫、failed 事件清理、静默降级加一条日志诊断、`once('click')` 处理。

- 展示带会话显示名与一行类别的通知——完成、失败、等待审批、等待提问——文案来自请求中携带的客户端 i18n 目录；不含任何会话内容，因为系统通知面比应用存活更久，且在锁屏与通知中心历史中可见；
- 点击时显示并聚焦窗口，把会话 id 转发给渲染进程，后者经 `uiWorkspace.openSession`——与会话列表相同的路径——在主视图打开该会话；打开后由现有的自动确认照常清除未读；
- 在退出确认、会话结束、强制更新遮罩等外壳自有流程期间抑制通知。

### 设置

一个客户端开关——`ui-workspace` 设置命名空间中的 `notifications`，默认开启——由桥接消费方在转发前读取，声明方式与聊天偏好相同：config-forms 命名空间加 `settings.general.item` 槽位。开关放在客户端 Cordis 设置里，因为触发器在客户端；外壳不加自己的设置，遵守 [shell configuration](../../implemented/architecture/2026-10-08-desktop-shell-configuration.zh.md) 的归属规则。浏览器标签页中该开关隐藏，因为尚无 Web Notification 适配器；注意力事件流与展示面无关，该适配器可以后续跟进而不动触发策略。

### 与既有笔记的关系

[Session reading state](../../implemented/feature/2026-10-23-session-reading-memory.zh.md) 拥有未读记录及其确认；本笔记只消费它的流，不取代其中任何部分。它推迟的可见性细化——区分设置或辅助面板与主视图——继续推迟：监视器使用同一条整页可见性信号。[Close-to-background](../../implemented/architecture/2026-09-23-desktop-close-to-background-and-quit-confirmation.zh.md) 的规则不变：关闭窗口本身不发通知；本笔记通知的是会话转换，不是窗口事件。本笔记的监视器是 [session attention system](2026-11-15-session-attention-system.zh.md) 的共享核心——后者增加应用内注意力栈与任务栏/托盘展示面；本笔记保留系统通知面及其在场条件。

## Alternatives considered

**由 Host 或 Electron 主进程监视会话状态发通知。** 未读、正在查看与焦点语义都在客户端；在外壳里复制它们意味着同一策略的第二权威与第二条设置路径。客户端已经算好了全部触发事实。

**渲染进程里的 HTML5 Notification API。** Electron 支持，但点击时唤起隐藏窗口反正需要主进程帮忙，各平台与各 Electron 版本的权限行为不一，外壳也无法在更新或退出流程中抑制通知。类型化 IPC 桥接与其它桌面能力一致。

**按未读状态而非按转换通知。** 稳态求值会在每个快照上重复触发，否则要自建去重簿记；转换才是自然单位——每次完成一条通知。

**同一变更里做浏览器 Web Notifications。** 不同的权限流程（浏览器显式授权）与不同的在场信号（标签页可见性）；先推迟，让桌面路径先验证触发策略。接缝设计使其可增量跟进。

**外壳自有通知文案。** 桌面外壳已为更新提醒携带八语言文案（从客户端 locale 同步）。类别文案也可以放在那里；随请求携带则把唯一事实源留在客户端目录，避免复制客户端已拥有的措辞。

**托盘/任务栏角标代替通知。** 更少打扰，但不携带会话身份，也没有点击打开的目标；Windows 托盘已存在。两者互补：通知点名一个会话，角标统计全部。

**正文里带最后一条消息。** 信息更多，但把会话内容泄漏到锁屏与通知历史。只用名称与类别。

## Consequences

系统通知面按上述触发策略落地，由 `packages/client/ui-workspace/tests/desktop-attention.client.spec.ts` 与 `apps/desktop/tests/session-attention.spec.ts` 覆盖。桥接承载四种类别与一对通道，退出时外壳清除通知与界面标记。

- 平台投递差异：Windows 通知激活依赖应用身份，专注助手可能吞掉通知，macOS 通知中心设置生效，Linux 依赖通知守护进程。与托盘工作一样，需要逐平台手工验证。
- 并行会话仍可能产生通知爆发；按会话只保留一条存活通知限制了堆叠，但真实使用后可能需要静默期策略。
- 渲染进程是触发源：窗口隐藏时页面崩溃或重载会让通知静默停止，而 Host 继续运行。接受；Host 侧路径是被否决的更重替代。
- `document.hasFocus()` 的边界情况（被遮挡但仍有焦点的窗口）在某些平台可能误判在场；验证覆盖真实序列。
