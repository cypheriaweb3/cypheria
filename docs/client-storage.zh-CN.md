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
| Desktop（TanStack Start renderer + Electron） | 浏览器 `localStorage` | IndexedDB | Electron 管理的 `userData/client-attachments` 文件，通过经过校验的 preload IPC 访问 |
| Expo Web | 浏览器 `localStorage` | IndexedDB | IndexedDB |
| Expo iOS 与 Android | AsyncStorage | `expo-sqlite` | 通过 `expo-file-system` 写入应用 document 目录 |

Desktop 和 Expo 在各自应用边界组合这些端口。调用方在使用 Replica 前先打开它，并在 runtime 销毁时关闭。Web adapter 在模块求值期间不访问浏览器全局变量，因此服务端渲染可以安全 import；真正读写存储仍需要浏览器 runtime。

## 键值状态

原始键值存储只持久化字符串。`@cypheria/storage/jotai` 提供 `atomWithValidatedStorage` 和 `createValidatedJotaiStorage`：值带有显式版本，读写时使用 Zod 校验，可按需迁移，损坏时会被移除。应用状态使用 Jotai；存储包不引入 Zustand。

键名必须稳定、带命名空间，并由单一领域所有。较大的集合和需要查询的记录应放进 Replica，而不是单个 JSON 值。

## Replica 存储

Replica 是语义记录存储，而不是跨平台 SQL API。每条记录包含 `scopeId`、`entityType`、`entityId` 和序列化 payload。所属领域定义 payload Schema，并在边界完成转换。

应用提供正整数语义 Schema 版本。版本变化时，adapter 会清空可重建 Replica，而不是暴露各平台不同的 migration。IndexedDB 和 SQLite 实现都会对批量 upsert 与 delete 提供原子性。Replica 内容必须能够从 Server 或其他持久来源重新获得。

## 附件二进制

附件 metadata 与二进制具有独立生命周期。领域在普通记录中保存 metadata，`AttachmentStore` 则通过生成的不透明 key 保存和读取 bytes。垃圾回收接收仍被引用的 key 集合，并删除无引用 blob。

Web adapter 把 blob 放在专用 IndexedDB 数据库中。Expo Native 放在应用 document 目录。Desktop 通过隔离 preload bridge 传输带上限的 `Uint8Array`；Electron main 校验 key、执行 32 MiB 限制，并且只在自己管理的目录内写文件。Renderer 永远不会获得文件系统路径或 Node.js 权限。

## 校验与安全

存储 adapter 会校验 identifier 和 storage type，但领域所有者仍须校验反序列化后的 Replica payload 与附件 metadata。客户端 Replica 和浏览器存储只是普通本地应用数据：它们不是加密秘密存储，重新连接 Server 后也不能被视为权威来源。

Electron 继续启用 context isolation 与 sandbox。附件 IPC 只接受 write、read、delete、list 四个已声明操作，不接受任意路径。协议可见或共享状态仍通过常规、经过 Zod 校验的 Client/Server 边界传递。
