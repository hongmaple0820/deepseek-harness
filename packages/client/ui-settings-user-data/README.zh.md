---
description: "用户数据设置页：导出可携带的备份包，并在应用前预览导入结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-user-data

[English](README.md) | 中文

## 概述

**设置 → 数据管理** 把一个 profile 带到另一台机器。该页按组件选择导出 ZIP 备份包，并以两步方式导入：选择文件只显示将要新增与替换的内容，只有点击应用按钮才会写入。个人设置文件与脱敏的偏好设置快照默认勾选；会话日志与凭据默认关闭。已配置的 WebDAV 与 S3 远端显示在文件操作下方，因此可以直接在该页推送与恢复同一种备份包。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web bundle 把本配套插件与 Host 的 `user-data-backup` 行一起挂载。用复选框选择组件后点击**下载备份包**，浏览器按 Host 给出的文件名保存。导入时点击**选择备份包**并选取 ZIP，先阅读计划变更：每个列出的组件都会说明将要新增与替换的路径，此时尚未写入磁盘。点击**应用导入**后才会写入，并报告保存被替换文件的备份目录。

Host 拒绝导入或备份包无法读取时，页面只显示一行失败信息而不显示计划。未选择任何组件时导出按钮被禁用，而不是下载一个空包。

**远端同步**列出部署已配置的每个远端，含类型与其中已有的备份包。**刷新远端**重新读取列表；**推送备份**上传当前选择，并报告保存的文件名与 Host 清理掉的旧包数量；对某一行点击**恢复**会下载该备份包并打开同一份预览，因此来自另一台机器的包绝不会未经检查就写入。未配置远端时页面直接说明，而不是显示空列表。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`transfer.ts` 负责路由地址、JSON 调用与已存备份包的下载，是唯一知晓线路细节的模块。`UserDataSection.tsx` 是只依赖 props 的纯组件：选择、远端列表、待应用计划、已应用结果与失败都存放在本地状态，下载动作由注入提供。`index.ts` 以自身语言命名空间注册 `settings.section` 页面，并注入点击锚点的下载动作。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [用户数据备份 Host 包](../../storage/user-data-backup/README.zh.md)——备份包结构、路由与导入规则。
- [设置](../ui-settings/README.zh.md)——设置分区如何声明与注册。
- [Web 客户端](../../../docs/subsystems/web-client.zh.md)——插件组合与设置界面。

<a id="model-experience"></a>
## 模型体验

无；该页面不贡献模型可见内容。

#### KV Cache 影响

无；该页面只在浏览器与本机之间搬运文件。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 页面在挂载时与手动刷新时读取远端列表；另一台机器之后推送的备份包需点击**刷新远端**才会出现。
- 上传较大的备份包时没有进度提示；推送按钮在 Host 应答前保持禁用。
- 计划按组件列出路径而不带单文件大小，因此勾选较大的会话备份时，应用前没有体积提示。

<a id="dev-note"></a>
### 开发备注

无。
