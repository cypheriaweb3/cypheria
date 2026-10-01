---
title: Composer 输入与引用
---

# Composer 输入与引用

## 所有权与数据流

共享 Tiptap 编辑器只管理展示状态。Desktop 在本设备保留各个草稿；Server 负责引用校验、上传字节、Thread 历史和 Agent 输入映射。选中的 mention 是按顺序排列的 `reference` 输入块，不会再从 Markdown 中反推身份。普通键入的 `@`、`$` 或 `/` 文本仍是文本。Server 在 start、steer 或 queue 提交前解析所选引用，并将原始结构化输入保存在用户 Timeline item 上，以便客户端恢复分支 composer。校验失败不会认领提交 receipt。

其他客户端可使用相同的 `@cypheria/client` API，而无需共享 Desktop 的本地草稿数据库。Thread API 不隐含草稿同步。

## 触发器与候选项

`@` 搜索工作区文件、现有 Thread、归属于该 Thread 的浏览器标签页，以及（Codex 下）已安装且启用的插件和 MCP 资源。`$` 搜索已启用的 Codex skills 与可访问且已启用的 Apps。候选查询使用 `threads.composer.suggest`；它限定到现有 Thread，或新 Thread 的拟用 Agent 与有序 roots，其中第一项 root 是拟用 cwd。Server 在提交时重新检查所选 ID，包括文件 realpath 是否仍在工作区内、浏览器标签页是否仍属于该 Thread。候选标签只用于显示，不是授权依据。

`/` 是 Desktop 本地命令菜单，不会向 App Server 发送 skill token。目前可执行的动作是附加文件、清空草稿、打开新聊天、查看状态、查看 goal，以及请求 Codex compact。未选择的斜杠文本会原样发送。斜杠项目不能执行任意工具，也不会为未声明能力的 Agent 虚构选择器。

## 提交映射

公共输入 union 包含文本、已有图片／音频／资源块、`reference` 和 `uploaded-file`。Server 将校验过的工作区文件映射为路径链接，Thread 映射为受限 `read_thread` 动态工具提示，浏览器标签页映射为当前标签页身份，并将已启用的 skill、App、插件或 MCP 资源映射为 Agent 可读指针。这些是提示和可解析标识符，而不是被引用内容的快照。模型或其工具仍须在获授权的执行环境中读取路径或资源。Thread 读取有界，并明确将内容标为不可信。所选 Agent 不支持的引用会在提交前失败，而不会悄悄退化为假的 mention。Server 保存原始 blocks，Agent 收到映射后的 blocks。

## 上传文件与草稿

Desktop 附件首先保存在本地 `AttachmentStore`。提交时，自有字节经 Server 上传 API 分块传输并做 SHA-256 校验；`upload.start/chunk/status/complete/abort` 支持按 offset 恢复。返回的不透明 file ID 作为 `uploaded-file` 发送，而不是客户端本地路径或 base64 prompt。Server 将文件绑定到 Thread，再将托管的本地资源映射为 Agent 输入。限定 Thread 的 `input-file.get` 允许另一客户端读取该 Thread 的已上传字节。上传和文件 ID 限制为 32 MiB；未绑定上传在 24 小时后清理。它与 pull request、worktree 等 Thread attachment artifact 不同。

草稿保存文本／结构化输入与有序附件 metadata，不保存二进制 base64。发送失败时保留草稿。上传本身不会产生 Timeline 消息。本地字节缺失时 UI 必须显示不可用并禁止提交。成功提交后，客户端可从包含结构化输入身份的 Canonical Timeline 重建可见历史；本地编辑器文档不会跨设备共享。

## 边界与限制

Server 不会从看起来像 Markdown 的文本中猜测语义 mention。`@agent` 有编辑器节点类型以备未来 Agent 专用集成，但 Server 不提供该候选项，并会在提交时拒绝。MCP 资源指针不会自动内联为字节；所选 Agent 仍需可用的读取器或工具。文件候选搜索有界，会忽略常见的生成目录，并非完整的仓库索引。二进制上传字节和客户端草稿独立于 Canonical Timeline；只有稳定 ID 与校验后的输入块进入历史。
