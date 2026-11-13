---
description: "可携带的用户数据备份包：一个 ZIP 装下个人设置文件与脱敏偏好设置，导入前先预览。"
kind: "package-reference"
---

# @deepseek-ai/dsh-user-data-backup

[English](README.md) | 中文

## 概述

`dsh-user-data-backup` 用一个 ZIP 备份包把某个 profile 带到另一台机器。它提供三个需要认证的 Host 路由：按组件选择导出备份包、预览导入会带来的变化、应用该导入。个人设置文件（`package.json` 与 `cordis.patch.yml`）与脱敏后的偏好设置快照是默认选择；会话日志与凭据需另外勾选。导入不会盲写：预览会报告新增与替换的文件，应用时先把每个被替换的文件复制到 `<DSH_HOME>/backups/<时间戳>/`。配置好的 WebDAV 与 S3 远端可把同一种备份包保存为不可变、按序递增的一组。

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

在提供 Connection 的环境中挂载本插件。它依赖 `connection`，从 `profileContext` 读取当前 profile，从 `settings` 服务读取偏好设置快照。设置页 [`ui-settings-user-data`](../../client/ui-settings-user-data/README.zh.md) 驱动全部三个路由。

| 路由 | 方法 | 返回 |
| --- | --- | --- |
| `/api/user-data.export?components=profile,settings` | GET、HEAD | 带 `Content-Disposition: attachment` 的 ZIP |
| `/api/user-data.import.preview` | POST（缓冲请求体） | `RestorePlan` JSON |
| `/api/user-data.import` | POST（缓冲请求体） | 写入后返回 `RestorePlan` JSON |
| `/api/user-data.remotes` | GET、HEAD | 已配置远端，形如 `{id, kind}` |
| `/api/user-data.sync.list?id=` | GET、HEAD | 远端中的 `{entries}` |
| `/api/user-data.sync.push?id=&components=` | POST | 上传后的 `{name, pruned}` |
| `/api/user-data.sync.bundle?id=&name=` | GET、HEAD | 已存取的 ZIP |

`RestorePlan` 按组件列出将要新增、替换或跳过的相对路径，以及应用步骤写入的备份目录。预览不写入任何内容。

### 备份包结构

`manifest.json` 位于首位，记录备份包 schema 版本、写入方版本、profile 名、包含会话时的会话格式版本，以及每个组件的文件数、字节数与是否脱敏。其后是 `profile/`、`settings/`、`sessions/`、`credentials/` 下的组件文件。

- **profile** —— 原样收录 `package.json` 与 `cordis.patch.yml`。
- **settings** —— 每个用户层的一份快照，写入 `settings/sections.json`；密钥只记录“已设置/未设置”标记，绝不记录值。
- **sessions** —— `<DSH_HOME>/sessions/` 下的会话日志。
- **credentials** —— 原样收录 `.credentials.yaml`；因其含真实密钥，默认关闭。

### 导入规则

若备份包中的会话由不同的会话格式版本写入，导入会被拒绝并同时报出两个版本。越出组件目录的路径会被拒绝。应用时通过 `settings` 服务替换包内的偏好设置分区，因此正在运行的客户端无需重新加载即可看到新值。

### 远端同步

插件配置 `remotes` 下的每个条目指定一个 WebDAV 或 S3 目标，以及保留多少份备份包：

```yaml
remotes:
  dav:
    kind: webdav
    url: https://dav.example.com/dsh
    username: me
    password: secret
    prefix: backups
    keep: 10
  s3:
    kind: s3
    endpoint: https://s3.example.com
    region: us-east-1
    bucket: dsh
    accessKeyId: key
    secretAccessKey: secret
```

缺少字段会在加载时报错，并点出远端与字段名。推送会导出一份备份包、以带时间戳的文件名上传，然后删除超出 `keep` 的最旧备份包（默认 10；`0` 表示全部保留）。已上传的备份包永不被覆盖：文件名带有到毫秒的创建时间。列举与下载只读；恢复远端备份包复用带预览的导入路径，因此来自另一台机器的包会先被检查再落盘。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`bundle.ts` 负责采集、manifest 约定、用 `fflate` 生成 ZIP，以及把 manifest 读在最前。`restore.ts` 是纯路径规划：把包内前缀映射到 profile 目录、`<DSH_HOME>/sessions` 与 `<DSH_HOME>`，拒绝越界与未知前缀，并把偏好设置快照从文件决策中分离。`remote.ts` 是传输层：基于 `PROPFIND`/`PUT`/`GET`/`DELETE` 的 WebDAV 客户端，与用 `node:crypto` 签名 SigV4 `ListObjectsV2`/`PutObject`/`GetObject`/`DeleteObject` 的 S3 客户端，统一在 `list`/`put`/`get`/`remove` 接口之后，另有 `pruneRemote`。`index.ts` 是 Cordis 服务：生成备份包、在 Connection 上注册路由、先把被替换的文件复制进备份目录再应用计划，并把每个配置好的远端变成上述接口。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [可携带用户数据备份提案](../../../.agents/notes/proposed/feature/2026-11-13-portable-user-data-backup.zh.md)——组件默认值、两步导入，以及这些路由背后的远端同步设计。
- [用户数据设置页](../../client/ui-settings-user-data/README.zh.md)——这些路由的浏览器界面。
- [设置](../../settings/settings/README.zh.md)——已接受的值、脱敏与实时生效。
- [主目录路径](../../util/home-paths/README.zh.md)——`DSH_HOME` 布局与 profile 目录。

<a id="model-experience"></a>
## 模型体验

无；没有任何路由贡献模型可见内容。

#### KV Cache 影响

无；备份包的写入与读取发生在模型输入之外。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 同步只对接 WebDAV 与 S3；其它后端需要自行实现 `list`/`put`/`get`/`remove`。
- 两台机器推送同一 profile 时会在远端留下两组序列，不做合并或比较。
- 导出路由同步读取整个 profile；勾选很大的 `sessions/` 时请求会一直持续到 ZIP 完成。
- 勾选凭据时凭据被原样收录，含凭据的备份包即为密钥。

<a id="dev-note"></a>
### 开发备注

备份包文件通过 `node:fs/promises` 读写；此处不接触会话持久化 API。
