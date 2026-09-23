---
title: Agent Harnesses
---

# Agent Harnesses

Cypheria 支持 Codex、Claude、Pi、OpenCode 四种第一方 Agent harness，以及 registry 驱动的 ACP Agent harness。Server 负责所有进程和原生协议，客户端使用通用 Agent、Thread、Timeline 和 integration API。

## 身份与兼容性

`@cypheria/protocol` 保留 `codex`、`claude`、`pi`、`opencode` 作为原生 ID。ACP registry ID 从每个 Cypheria release 提交并审核的稳定 registry 快照生成，并构成运行时 allowlist；上游新增 entry 必须等 Cypheria 更新该快照后才可用。Integration 使用更宽泛的 `codex`、`claude`、`pi`、`opencode`、`acp` compatibility tags，使一条声明可以覆盖 registry Agents。

Agent descriptor 报告来源、distribution、已安装和可用版本、启用状态、runtime 状态、能力、兼容性和诊断。Thread 身份始终使用 Cypheria Thread ID 与 Agent ID；harness session ID 只是可选关联，不是客户端缓存主键。

## Registry 与安装

提交到仓库且通过 schema 校验的稳定 ACP `registry.json` 是可用 ACP catalog。运行时进程不会下载或合并 registry 数据；更新它必须由维护者显式运行生成命令、完成审查，并保证生成的 ID allowlist 与快照一致。Cypheria 不接受包含 `preview` 数据的源 manifest，也不消费 preview registry。原生 harness 不从稳定 registry 获取版本：每个 Cypheria release 都为 Codex、Claude、Pi 和 OpenCode 声明一个经过测试的 CLI package 与精确版本。持久化的 `agent_registry` 并不是 ACP catalog 的全量副本：它初始包含四个原生 harness，只有用户执行添加后才写入相应 registry Agent；每条记录都保存 `createdAt`。ACP distribution metadata 可以同时提供平台 binary、`npx` 和 `uvx`；当前平台按这个顺序确定性选择。平台 archive 可以携带 SHA-256 完整性信息。

添加、安装和删除 registry 记录是三个独立操作。添加会持久化所选 Agent 并开放其设置页；安装和更新是带 operation record 与进度 notification 的 Server 操作。Binary archive 会流式写入磁盘，并按字节进度解压，而不是整体缓存在内存中；支持 registry 格式声明的 ZIP、gzip tar 和 bzip2 tar distribution。Archive 会拒绝路径穿越、符号链接、硬链接、设备与 FIFO，声明的命令也必须解析到解压根目录内。安装成功后会自动启用 Agent。卸载只删除托管 runtime、保留 registry 记录，并始终禁用 Agent；删除该未安装记录是另一个独立操作。仅当精确的原生 manifest 或已提交 ACP 快照中存在比已安装版本更高的有效语义化版本时，Server 才接受 Agent 更新。不同 Agent 的 operation 可以并发运行，同一 Agent 的 operation 仍会串行执行。Toolchain manager 会在 Cypheria home 下安装仓库中固定版本的 Node.js、Python 和 uv，并直接用该 manifest 比较已安装版本，不会在运行时解析 latest release。Node.js 与 uv archive 必须匹配仓库中为当前平台固定的 SHA-256。Registry package 遵循 FORMAT.md 语义：npm 自行执行 `npx` 的 executable 选择，uv 则物化与 `uvx` 相同的隔离工具与命令。每次安装的 uv tool 和命令目录会覆盖共享 toolchain 默认值，确保激活的 receipt 自包含。已安装 Agent 状态会报告最终选择的 distribution 类型和来源。只有确认的上游特定版本缺陷才进入显式、精确版本的 compatibility manifest；普通 entry 不使用覆盖。客户端可以列出、添加、删除、安装、更新、卸载、启用、禁用、启动和停止 Agents，但不会获得文件系统或进程权限。

## Catalog 与默认值

公开 harness catalog 会统一 models、providers、认证方式以及可配置的新 session 默认值，不暴露原生 Agent 协议。`HarnessCatalogManager` 按 Agent 与配置代次在内存中保留一份 snapshot。Catalog 按需加载，并发读取共享一次发现；普通渲染或导航不会再次启动 runtime。显式刷新、安装变化、认证变化、registry 变化或影响 catalog 的设置会使 snapshot 失效。刷新失败时保留上一份 snapshot，并标记为 stale。

设置以带稳定 section 的类型化 `select`、`boolean` 或 `number` definition 描述。Server 按最新 definitions 校验每次更新。非密钥默认值按 Agent ID 持久化，并应用于新 session；凭证留在 harness 自己的 credential store 中，绝不进入配置、协议响应或日志。已经失效的保存值会保持可见并标记无效，直到用户替换。

认证以包含互斥 method 的 provider 建模，而不是扁平 method 列表。Codex、Claude 和 ACP Agent 暴露一个逻辑 provider；Pi 与 OpenCode 暴露多个 provider，且每个 provider 只允许一个 active connection。OpenCode method form 会被归一化为带类型、支持条件的字段，并按最近一次发现的 definition 校验。已有连接或正在认证的 provider 必须先断开连接或取消 flow，才能启动另一种 method。Login、交互响应、轮询、取消、定向 logout 和连接测试均在 Server 中执行；Desktop 把对应用户操作显示为 Configure 与 Disconnect。浏览器、设备码、command 和 terminal flow 保留由发起请求的 client session 所有的可取消资源；关闭该 session 或停止 Server 会中止 flow，并释放其进程、终端和 reservation。连接测试会使用侵入性最低的 adapter 专属认证操作：Codex 与 Claude 刷新账户发现，Pi 与 OpenCode 发起最小 provider 请求，registry Agent 则执行 ACP 握手和临时 session probe。Pi 和 OpenCode 的 API key 配置也会在接受凭证前执行该 provider 请求；若校验失败，会再次移除该凭证。

## Runtime 生命周期

Agent manager 按 Agent 串行化生命周期转换、报告健康状态，并区分 installed、enabled 和 running。未安装 Agent 必定处于禁用状态，且只有已安装 Agent 才能切换 enabled。禁用的 Agent 不能启动。停止的 Agent 仍可拥有持久 Threads；恢复 Thread 时会启动或复用相应 runtime。Codex、Claude、Pi、OpenCode 和 ACP 的并发请求按 Agent 或 session 共享一次待完成的 runtime 初始化；初始化失败后会移除该记录，允许后续请求重试。更新正在运行的 harness 前，Server 会阻止新 turn、等待 active turn 完成、挂起其 sessions、停止旧 runtime、激活新版本并恢复 sessions。Server 关闭时会终止安装子进程；下次启动会清理被中断的 staging 目录、临时下载、原子写入残留和未完成的版本激活。

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

OpenCode harness 仅支持 OpenCode v2。动态安装使用固定版本的 `@opencode/cli`，不再使用 ACP registry distribution；Server 对接使用配套的 `@opencode/client` v2 API。Cypheria 会禁用 OpenCode 自更新、监管其本地 service、消费 v2 event stream，并把 sessions、messages、forms、permissions、models、integrations 和 credentials 映射到通用 Thread、Timeline、catalog 与认证契约。不保留任何 OpenCode v1 兼容路径。

### ACP

ACP harness 使用官方 ACP SDK，并在 Server 内把稳定 v1 与 v2 协议表面严格分开。每条连接都先发送包含 v2 `info` 与 `capabilities` 的 v2 `initialize` 请求；Agent 支持 v2 时返回 v2，否则返回它支持的最新版本 v1。此后 Cypheria 在这条连接上只使用协商出的版本；若返回不支持的版本则断开，且不会在同一连接上重新初始化或混用 v1/v2 消息。Initialize 和 discovery request 会为回复前需要准备本地状态的 Agent 保留有界的冷启动时间。Google Antigravity 1.1.1 会报告版本 2，却返回其余字段均符合 v1 的 initialize 结构；Cypheria 只识别这一精确的混合结构，关闭无效连接，再建立一条明确协商 v1 的新连接。认证发现只执行初始化：Server 会记录 Agent 广告的认证方式与 logout 支持情况，但不会创建 session。协议驱动认证在 v2 使用 `auth/login` 与 `auth/logout`，在 v1 使用 `authenticate` 与 capability-gated `logout`；terminal 认证会运行 Agent 广告的交互式 invocation，并在后续使用时通过新初始化的 runtime 延迟重连。Catalog 发现是独立操作，会创建临时 session 并读取 model 与 configuration options。ACP 的 authentication-required error 会成为正常的 `authentication-required` catalog 状态，而不是刷新失败。Server 只在协商后的协议表面广告相应 capability 时调用 `session/delete`，并始终在 `finally` 路径关闭临时 runtime。

正式 Thread session 同样遵循协商后的生命周期。在 v2 中，出现 `capabilities.session` 即表示支持基础 session 方法；恢复使用 `session/resume`，`session/prompt` 的接受响应不代表 turn 已结束，只有 idle `state_update` 才结束 turn。在 v1 中，Cypheria 继续使用 v1 capability 布局、`session/load`、prompt response 语义与 mode 方法。V2 的 mode/model 默认值通过带类型的 configuration options 应用。ACP connection header 与传输细节不会成为公开 Cypheria 消息字段。

## Canonical 适配

语义匹配时，harness 优先生成通用 Timeline item。Agent 专属数据放入 `harnessData`；只有无法忠实表达的事件才使用 `harness` item。Permissions、questions 和 MCP elicitation 转换为通用 Thread interactions。

持久化 Canonical Timeline 是唯一权威。已提交的用户 row 以 `clientMessageId` 作为公开身份；Agent 回显该消息时，adapter 会把回显校正到已有 row，并持久补全其内部 `agentMessageId`，而不是追加重复消息。原生事件可以保留或记录用于调试，但 Desktop、Expo、CLI 和 AI SDK providers 不从 harness 进程重建历史。

## 客户端会话消费者

会话客户端直接使用 `@cypheria/client`。Desktop 的公共 controller 负责分页、订阅、epoch 与缺口恢复、send、steer、queue、cancel 和 interaction response，不再把数据转换成第二套消息格式。Codex controller surface 还通过 `client.harnesses.codex` 读取 goal、原生 queue、usage、权限、模型设置、review 与后台 terminal 状态。其他 Agent 在拥有专用 workspace 之前使用公共 Thread surface。

## 安全与故障处理

- 把 Agent 输出、tool request、文件路径和 integration metadata 视为不可信输入。
- 凭证、callback、进程 handle 和原生 connection ID 留在 Server。
- 所有审批都通过 Thread interaction 生命周期处理。
- Server 关闭时终止子进程；暴露 crash 状态但不丢失持久历史。
- 使用前校验 registry document、平台选择、archive、checksum 和原生消息。

多 Agent 编排尚未实现；每个 Thread 只选择一个 Agent runtime。
