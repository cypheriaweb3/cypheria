# Agent Harnesses

Cypheria 支持 Codex、Claude、Pi、OpenCode 四种第一方 Agent harness，以及 registry 驱动的 ACP Agent harness。Server 负责所有进程和原生协议，客户端使用通用 Agent、Thread、Timeline 和 integration API。

## 身份与兼容性

`@cypheria/protocol` 定义稳定 Agent ID。`codex`、`claude`、`pi`、`opencode` 是原生 ID；生成的 registry ID 标识 ACP Agent。Integration 使用更宽泛的 `codex`、`claude`、`pi`、`opencode`、`acp` compatibility tags，使一条声明可以覆盖 registry Agents。

Agent descriptor 报告来源、distribution、已安装和可用版本、启用状态、runtime 状态、能力、兼容性和诊断。Thread 身份始终使用 Cypheria Thread ID 与 Agent ID；harness session ID 只是可选关联，不是客户端缓存主键。

## Registry 与安装

Server 把固定版本的 ACP registry 文档作为可用 catalog 加载并校验，同时提供刷新和检查操作。持久化的 `agent_registry` 并不是 catalog 的全量副本：它初始包含四个原生 harness，只有用户执行添加后才写入相应 registry Agent；每条记录都保存 `createdAt`。Distribution metadata 可以选择平台 binary、`npx` 或 `uvx`；preview release 始终显式标记。平台 archive 可以携带 SHA-256 完整性信息。

添加与安装是两个独立操作。添加会持久化所选 Agent 并开放其设置页；安装和更新是 Server 操作，拥有持久 operation records 与进度 notifications。Toolchain manager 在 Cypheria cache 下发现或安装托管的 Node 和 Python 工具。客户端可以列出、添加、安装、更新、卸载、启用、禁用、启动和停止 Agents，但不会获得文件系统或进程权限。

## Catalog 与默认值

公开 harness catalog 会统一 models、providers、认证方式以及可配置的新 session 默认值，不暴露原生 Agent 协议。`HarnessCatalogManager` 按 Agent 与配置代次在内存中保留一份 snapshot。Catalog 按需加载，并发读取共享一次发现；普通渲染或导航不会再次启动 runtime。显式刷新、安装变化、认证变化、registry 变化或影响 catalog 的设置会使 snapshot 失效。刷新失败时保留上一份 snapshot，并标记为 stale。

设置以带稳定 section 的类型化 `select`、`boolean` 或 `number` definition 描述。Server 按最新 definitions 校验每次更新。非密钥默认值按 Agent ID 持久化，并应用于新 session；凭证留在 harness 自己的 credential store 中，绝不进入配置、协议响应或日志。已经失效的保存值会保持可见并标记无效，直到用户替换。

## Runtime 生命周期

Agent manager 串行化生命周期转换、报告健康状态，并区分 installed、enabled 和 running。禁用的 Agent 不能启动。停止的 Agent 仍可拥有持久 Threads；恢复 Thread 时会启动或复用相应 runtime。

每个 runtime 实现 Thread manager 使用的公共 harness adapter：

- 在支持时创建、恢复、fork、配置和关闭 session；
- 按发布能力启动、steer 和取消 turn；
- 发出 Canonical Timeline rows 和归一化 interactions；
- 保留诊断或 harness UI 扩展所需的 metadata。

能力按 Agent 和 Thread 发现。客户端不得暴露不支持的输入类型、steering、配置或 fork 操作。

## 第一方 Harnesses

### Codex

Codex harness 负责 Cypheria 管理的 Codex App Server 进程，并使用 `@cypheria/protocol` 的生成产物校验消息。它把 Codex turns、reasoning、plans、commands、文件变更、approvals、artifacts、account、models 和 permissions 映射为 Cypheria 契约。公共 harness facade 支持 API key、ChatGPT browser 和 ChatGPT device-code 认证。Codex Apps 仍是 Codex/OpenAI harness 扩展。

### Claude

Claude harness 使用固定版本的 Claude Agent SDK。Server 负责带 callback 的 hooks、permissions、abort control、MCP server objects、session storage、process factories、subscription 与 Console account 认证，以及登出。可序列化 prompt 与 SDK 输出会归一化为 Thread input、Timeline items、interactions 和 harness events。

### Pi

Pi harness 使用固定版本的 Pi coding-agent 包及其 RPC session model。它会发现 provider models 与各 provider 的 account、OAuth、device-code 或 API-key 认证方式，并把消息流、tool activity、配置、session 生命周期和 extension metadata 映射到通用 Thread 契约。Pi extensions 表示为 Pi 生态插件，不等同于 Cypheria 原生插件。

### OpenCode

OpenCode harness 使用固定版本的 OpenCode SDK，监管其 server 连接，并动态发现 provider 的 API-key 与 OAuth 方法。它把 sessions、messages、parts、permissions 和 provider 配置映射到同一 Thread 与 Timeline 模型。

### ACP

ACP harness 使用官方 ACP SDK 和所选 Agent 声明的协议版本。Cypheria 在 Server 内归一化稳定 v1 与 draft v2 calls、notifications、responses、cancellation、agent 与 terminal 认证，以及 v2 batches。Catalog 发现使用临时 session，读取 model 和 configuration options，删除 session，并在 `finally` 路径关闭 runtime。ACP connection header 与传输细节不会成为公开 Cypheria 消息字段。

## Canonical 适配

语义匹配时，harness 优先生成通用 Timeline item。Agent 专属数据放入 `harnessData`；只有无法忠实表达的事件才使用 `harness` item。Permissions、questions 和 MCP elicitation 转换为通用 Thread interactions。

持久化 Canonical Timeline 是唯一权威。原生事件可以保留或记录用于调试，但 Desktop、Expo、CLI 和 AI SDK providers 不从 harness 进程重建历史。

## AI SDK Providers

`@cypheria/ai-sdk-provider` 导出 `acp`、`codex`、`claude`、`pi` 和 `opencode` 子路径。各 provider 依赖 `@cypheria/client` 而非 Agent SDK，默认绑定持久 Cypheria Thread，流式消费 Timeline 变化，映射 tool 和 reasoning parts，并在 abort 时取消 Server turn。

Provider metadata 保留 Agent kind、model、原生 ID 和受支持扩展数据。该包对浏览器安全：不能启动进程、读取文件或访问数据库。

## 安全与故障处理

- 把 Agent 输出、tool request、文件路径和 integration metadata 视为不可信输入。
- 凭证、callback、进程 handle 和原生 connection ID 留在 Server。
- 所有审批都通过 Thread interaction 生命周期处理。
- Server 关闭时终止子进程；暴露 crash 状态但不丢失持久历史。
- 使用前校验 registry document、平台选择、archive、checksum 和原生消息。

多 Agent 编排尚未实现；每个 Thread 只选择一个 Agent runtime。
