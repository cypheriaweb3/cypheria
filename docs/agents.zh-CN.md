# Agents

> 状态：当前实现

Cypheria 支持 Codex、Claude、Pi、OpenCode 四种第一方 Agent，以及 registry 驱动的 ACP Agents。Server 负责所有进程和原生协议，客户端使用通用 Agent、Thread、Timeline 和 integration API。

## 身份与兼容性

`@cypheria/protocol` 定义稳定 Agent ID。`codex`、`claude`、`pi`、`opencode` 是原生 ID；生成的 registry ID 标识 ACP Agent。Integration 使用更宽泛的 `codex`、`claude`、`pi`、`opencode`、`acp` compatibility tags，使一条声明可以覆盖 registry Agents。

Agent descriptor 报告来源、distribution、已安装和可用版本、启用状态、runtime 状态、能力、兼容性和诊断。Thread 身份始终使用 Cypheria Thread ID 与 Agent ID；provider session ID 只是可选关联，不是客户端缓存主键。

## Registry 与安装

Server 加载并校验固定版本的 ACP registry 文档，提供刷新和检查操作。Distribution metadata 可以选择平台 binary、`npx` 或 `uvx`；preview release 始终显式标记。平台 archive 可以携带 SHA-256 完整性信息。

安装和更新是 Server 操作，拥有持久 operation records 与进度 notifications。Toolchain manager 在 Cypheria cache 下发现或安装托管的 Node 和 Python 工具。客户端可以列出、安装、更新、卸载、启用、禁用、启动和停止 Agents，但不会获得文件系统或进程权限。

## Runtime 生命周期

Agent manager 串行化生命周期转换、报告健康状态，并区分 installed、enabled 和 running。禁用的 Agent 不能启动。停止的 Agent 仍可拥有持久 Threads；恢复 Thread 时会启动或复用相应 runtime。

每个 runtime 实现 Thread manager 使用的公共 provider adapter：

- 在支持时创建、恢复、fork、配置和关闭 session；
- 按发布能力启动、steer 和取消 turn；
- 发出 Canonical Timeline rows 和归一化 interactions；
- 保留诊断或 provider UI 扩展所需的 metadata。

能力按 Agent 和 Thread 发现。客户端不得暴露不支持的输入类型、steering、配置或 fork 操作。

## 第一方 Adapters

### Codex

Codex adapter 负责 Cypheria 管理的 Codex App Server 进程，并使用 `@cypheria/protocol` 的生成产物校验消息。它把 Codex turns、reasoning、plans、commands、文件变更、approvals、artifacts、account、models 和 permissions 映射为 Cypheria 契约。Codex Apps 仍是 Codex/OpenAI provider 扩展。

### Claude

Claude adapter 使用固定版本的 Claude Agent SDK。Server 负责带 callback 的 hooks、permissions、abort control、MCP server objects、session storage 和 process factories。可序列化 prompt 与 SDK 输出会归一化为 Thread input、Timeline items、interactions 和 provider events。

### Pi

Pi adapter 使用固定版本的 Pi coding-agent 包及其 RPC session model，把消息流、tool activity、配置、session 生命周期和 extension metadata 映射到通用 Thread 契约。Pi extensions 表示为 Pi 生态插件，不等同于 Cypheria 原生插件。

### OpenCode

OpenCode adapter 使用固定版本的 OpenCode SDK，监管其 server 连接，并把 sessions、messages、parts、permissions 和 provider 配置映射到同一 Thread 与 Timeline 模型。

### ACP

ACP runtime 使用官方 ACP SDK 和所选 Agent 声明的协议版本。Cypheria 在 Server 内归一化稳定 v1 与 draft v2 calls、notifications、responses、cancellation 和 v2 batches。ACP connection header 与传输细节不会成为公开 Cypheria 消息字段。

## Canonical 适配

语义匹配时，adapter 优先生成通用 Timeline item。Agent 专属数据放入 `providerData`；只有无法忠实表达的事件才使用 `provider` item。Permissions、questions 和 MCP elicitation 转换为通用 Thread interactions。

持久化 Canonical Timeline 是唯一权威。原生事件可以保留或记录用于调试，但 Desktop、Expo、CLI 和 AI SDK providers 不从 provider 进程重建历史。

## AI SDK Providers

`@cypheria/ai-sdk-provider` 导出 `acp`、`codex`、`claude`、`pi` 和 `opencode` 子路径。各 provider 依赖 `@cypheria/client` 而非 Agent SDK，默认绑定持久 Cypheria Thread，流式消费 Timeline 变化，映射 tool 和 reasoning parts，并在 abort 时取消 Server turn。

Provider metadata 保留 Agent kind、model、原生 ID 和受支持扩展数据。该包对浏览器安全：不能启动进程、读取文件或访问数据库。

## 安全与故障处理

- 把 Agent 输出、tool request、文件路径和 integration metadata 视为不可信输入。
- 凭证、callback、进程 handle 和原生 connection ID 留在 Server。
- 所有审批都通过 Thread interaction 生命周期处理。
- Server 关闭时终止子进程；暴露 crash 状态但不丢失持久历史。
- 使用前校验 registry document、平台选择、archive、checksum 和原生消息。

多 Agent 编排不属于当前实现；每个 Thread 当前只选择一个 Agent runtime。
