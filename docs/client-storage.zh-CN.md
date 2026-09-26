---
title: 客户端存储
---

# 客户端存储

`@cypheria/storage` 为 Cypheria 客户端定义本地、跨平台的持久化能力，用于 UI 状态、可重建的客户端 Replica 和附件二进制。它不是第二套权威产品数据库，也不替代 Server 或 `@cypheria/db`。

## 所有权与范围

客户端领域只依赖自己所需的最小语义端口：

- `KeyValueStorage` 保存小型字符串值，供经过校验的 Jotai atom 和其他本地偏好使用。
- `ReplicaStore` 保存由 scope、entity type 和 entity ID 标识的记录。领域所有者负责序列化和校验 payload；端口负责 transaction、查询、scope 重命名或删除，以及 Schema 重置。
- `AttachmentStore` 将二进制内容与附件 metadata 分开保存。Metadata 只包含不透明 storage key 和 storage type，不包含任意文件路径。

只有可重建或仅属于设备的数据才应进入这里。Thread、Timeline 历史、Schedule、Wallet policy、audit record、integration 和共享设置仍由 Server 所有，并通过 `@cypheria/client` 访问。私钥、mnemonic、token、signer 和其他秘密不得使用这些存储。

## Runtime 组合

| Runtime | 键值存储 | Replica | 附件二进制 |
| --- | --- | --- | --- |
| Desktop（TanStack Start renderer + Electron） | Electron 管理的 SQLite `~/.cypheria/desktop/kv.sqlite` | Electron 管理的 SQLite `~/.cypheria/desktop/replica.sqlite` | Electron 管理的 `~/.cypheria/desktop/attachments` 文件 |
| Expo Web | 浏览器 `localStorage` | IndexedDB | IndexedDB |
| Expo iOS 与 Android | AsyncStorage | `expo-sqlite` | 通过 `expo-file-system` 写入应用 document 目录 |

Desktop 和 Expo 在各自应用边界组合这些端口。Electron main 是两份 Desktop SQLite 数据库和附件文件的唯一所有者；沙盒化 renderer 通过经过校验的 preload bridge 访问三种存储。在 Desktop 上，Electron main 会在整个应用生命周期内保持共享 Replica 打开，因此销毁一个 renderer 不会关闭其他窗口仍在使用的存储。其他调用方在使用 Replica 前先打开它，并在 runtime 销毁时关闭。Web adapter 在模块求值期间不访问浏览器全局变量，因此服务端渲染可以安全 import；真正读写存储仍需要浏览器 runtime。

## 键值状态

原始键值存储只持久化字符串。`@cypheria/storage/jotai` 提供 `atomWithValidatedStorage` 和 `createValidatedJotaiStorage`：值带有显式版本，读写时使用 runtime Schema 校验，损坏或版本不同时会被移除。应用状态使用 Jotai；存储包不引入 Zustand。Desktop 键值变更由 Electron main 广播，因此同一安装中的每个 renderer 窗口都能观察同一份 SQLite 状态；该通知不承担跨客户端同步。

键名必须稳定、使用语义化 camelCase，并由单一领域所有。客户端设置不增加 `cypheria`、`client` 或 `desktop` 前缀。静态设置每项一个 key；动态记录使用 `composerDraft:<scopeId>` 和 `panelLayout:<threadId>`。所有定义都从 envelope 版本 1 开始。较大的可重建集合和需要查询的记录应放进 Replica，而不是单个 JSON 值。

Desktop 设置通过分类、key、Schema、默认值与版本统一注册。Renderer 组件使用同一个显式 vanilla Jotai store 中的校验 atom。Electron main 使用同一套 codec 和定义读取启动期外观、locale，以及带操作系统副作用的设置。不再存在独立 Desktop 设置 JSON 文件或宽泛的设置 IPC。

检查接口使用 keyset 分页并按键名查询。它只读取当前页的值，最多返回 240 个字符的预览和原始字符数。

## Replica 存储

Replica 是语义记录存储，而不是跨平台 SQL API。每条记录包含 `scopeId`、`entityType`、`entityId` 和序列化 payload。所属领域定义 payload Schema，并在边界完成转换。

应用提供正整数语义 Schema 版本。版本变化时，adapter 会清空可重建 Replica，而不是暴露各平台不同的 migration。IndexedDB 和 SQLite 实现都会对批量 upsert 与 delete 提供原子性。Desktop Replica 数据库与 `kv.sqlite` 在物理层分离，因此重建 Replica 不会删除键值状态。Replica 内容必须能够从 Server 或其他持久来源重新获得。

Replica 检查同样使用不透明 keyset cursor。查询会扫描记录 key 和序列化 payload，但结果只包含最多 240 个字符的 payload 预览及完整字符数。

## 附件二进制

附件 metadata 与二进制具有独立生命周期。领域在普通记录中保存 metadata，`AttachmentStore` 则通过生成的不透明 key 保存和读取 bytes。垃圾回收接收仍被引用的 key 集合，并删除无引用 blob。

`SaveAttachmentInput` 接受带判别字段的 `source`：`bytes`、`blob`、Base64 `data_url` 或 `file_uri`。MIME type 可省略，并在可能时从 Blob 或 data URL 推断；未提供文件名时会从 file URI 推断。Expo Native 通过其文件系统 API 解析 file URI。在 Desktop 中，`file_uri` 使用直接复制的快速路径：IPC 只传递 URI 与 storage key，由 Electron main 直接把源文件复制进托管存储，不在 renderer 中物化文件 bytes。其他 source kind 仍保留有大小限制的 bytes 传输回退路径。

Web adapter 把附件 bytes 放在专用 IndexedDB 数据库中。Expo Native 放在应用 document 目录。Desktop 只为内存 source 通过隔离 preload bridge 传输带上限的 `Uint8Array`；file URI source 由 Electron main 直接复制。Main 会校验存储请求，拥有 `kv.sqlite`、`replica.sqlite` 与附件目录，执行 32 MiB 附件限制，并且只在自己管理的路径内写入。Renderer 永远不会获得 Node.js 权限。

Composer 草稿在 KV 中保存文本、有序附件 metadata、状态与更新时间，绝不内嵌 base64。图片、音频、文件、粘贴文本和 appshot 的自有字节保存在 `AttachmentStore`。浏览器标签页与 MCP 资源保留可恢复引用和可见的降级／不可用状态；选中文本与受限 app context 保持自包含。恢复时通过 `AttachmentStore.stat()` 校验，因此不会为了检查而读取大文件。二进制缺失时禁止提交，直到移除或重新附加。草稿清理保持有界，并驱动附件垃圾回收。

附件检查按页返回 key、大小以及最多前 32 字节。文件 adapter 只读取该前缀；Web adapter 把前缀保存在 metadata object store 中，因此列表查询不会加载完整 blob。

## 校验与安全

存储 adapter 会校验 identifier 和 storage type，但领域所有者仍须校验反序列化后的 Replica payload 与附件 metadata。客户端 Replica 和浏览器存储只是普通本地应用数据：它们不是加密秘密存储，重新连接 Server 后也不能被视为权威来源。

Electron 继续启用 context isolation 与 sandbox。附件 IPC 只接受已声明并经过 Schema 校验的操作；file URI 复制仍受附件托管目录和大小限制约束。协议可见或共享状态仍通过常规、经过 Zod 校验的 Client/Server 边界传递。
