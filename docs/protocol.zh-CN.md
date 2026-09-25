---
title: 客户端与 Server 协议
---

# 客户端与 Server 协议

`@cypheria/protocol` 是公开 Cypheria 客户端/Server 契约的事实来源，导出严格 TypeScript 类型、编译后的 Zod 校验器、序列化器、能力常量，以及 Server adapter 内部使用的生成型上游产物。

## 范围

公开协议覆盖 Server 运维、Agents、Projects、Threads、Sections、Canonical Timeline、Integrations、Schedules、Terminals、Git 和 Web3。Agent 原生协议不是公开客户端 API，而是 `apps/server` 背后经过校验的 adapter 输入。

生成的 Codex App Server 文件位于 `packages/protocol/src/generated/codex/`。其[生成参考](codex-app-server-api.zh-CN.md)服务于 adapter 开发，不用于客户端直接调用。

## 传输

客户端通过 WebSocket subprotocol `cypheria.v1` 连接 `/api/v1/ws`。所有应用 frame 都是二进制，并包含由 `cbor2` 编码的确定性 CBOR 消息；文本 frame 会被拒绝。公开 profile 允许 null、boolean、string、有限 number、以 `number` 或 `bigint` 表示的整数、以 `Uint8Array` 表示的 byte string、array，以及仅使用 string key 的 map。值为 `undefined` 的可选对象属性会在编码前被省略；其他位置的 `undefined` 会被拒绝，且永远不会出现在 wire 上。该 profile 还拒绝自定义 tagged type、非 string map key、重复 key 和超过协议限制深度的结构。每个解码值仍会经过对应方向的 Zod Schema 校验。

顶层消息为：

```ts
{ type: "hello", clientId, clientType, protocolVersion, appVersion?, capabilities? }
{ type: "ping" }
{ type: "pong" }
{ type: "session", message: logicalMessage }
```

除 ping 外的第一条客户端消息必须是 `hello`。支持的 client kind 为 `desktop`、`mobile`、`web`、`cli`、`mcp` 和 `hub`。附着成功由 `server.status.notification` 确认；协议不公开 session ID 或 resume token。

Server 会拒绝不兼容版本、畸形消息、同一源传输中重复的在途 request ID、超限 frame，以及未在截止时间前发送 hello 的连接。

## 逻辑消息

每条逻辑消息都有具体的点分 `type`。Request 带 `requestId`，对应 response 返回相同 ID。领域 Schema 通常把参数放在 `payload` 中，并以类型化 `{ ok: false, error }` 结果表示领域失败，而不是传输失败。Notification 无需关联。

消息族示例：

```text
server.status.request              -> server.status.response
project.list.request               -> project.list.response
thread.turn.start.request          -> thread.turn.start.response
thread.timeline.appended.notification
schedule.run.request               -> schedule.run.response
web3.signing_intent.create.request -> web3.signing_intent.create.response
```

准确字段以导出的 Zod Schema 为准，而不是本文示例。

Agent management 会区分持久化 registry 与可用 harness catalog。`agent.list` 返回已注册 Agents 和当前可添加的 catalog entries，并包含各 entry 的可安装版本；已安装 Agent view 还会报告最终选择的 distribution 类型与来源。Registry ID 受当前 Cypheria release 提交的稳定 ACP 快照所生成的 allowlist 约束。`agent.add` 只持久化一个 catalog entry，不执行安装。安装仍由显式 `agent.install` operation 完成，卸载会保留并禁用 registry 记录，`agent.remove` 用于删除未安装记录。Install 与 update operation 会报告从 `0` 到 `1` 的归一化进度，按 Agent 而非全局串行执行，并在版本切换时保留 active turn。只有 release 固定的 catalog 版本高于已安装语义化版本时，Server 才接受更新。

## 版本与能力

`CYPHERIA_PROTOCOL_VERSION` 控制传输兼容性。客户端必须拒绝无法安全消费的 Server 协议版本。`server.status.notification` 会发布稳定 capabilities 和可选 feature flags。客户端应据此控制可选 UI，而不是假设应用版本必然对应某个功能。

未知 feature flag 名称会被保留。同一协议版本优先采用可选字段的追加演进；不兼容的形状变更需要新协议版本。

## Projects、Threads 与 Sections

Project 组织 workspace roots 和有序 Thread membership。Thread 是持久 Agent 会话身份，包含 `agentId`、harness session 关联、状态、能力、待处理 interactions、最近时间、归档状态，以及可选 Project 或 Section 位置。Section 同时排序 Projects 和独立 Threads。

协议提供创建、读取、列表、更新、移动、membership、归档和删除操作。顺序使用显式 position 和 `before...` 位置提示。固定 Pinned Section 由稳定协议常量表示；客户端不从 harness 元数据推断 Section 归属。

Project 与 Section membership 也作为规范化列表资源提供。Project membership 携带 `threadId`、`projectId`、position 与 timestamps；Section membership 携带 item reference、`sectionId`、position 与 timestamps。Project、Section 和 membership mutation 会发布类型化的 created、updated、upserted 与 deleted notifications，因此客户端可以维护规范化的本地 collections，而无需 N+1 membership 读取或轮询。逻辑删除 notification 会在 tombstone 提交后、延迟物理清理前发布；排序操作会发布所有受影响记录的规范 position。

当 Thread 属于某个 Project 时，其规范化后的 `cwd` 必须与 Project 已保存的某个 root 完全一致；省略 `cwd` 时使用排在首位的主要 root。持久化边界会在创建 Thread、将 Thread 移入 Project 或修改 `cwd` 时强制检查该不变量，并阻止 Project 更新移除仍被成员 Thread 使用的 root。Codex 在 start、fork、resume 和每次 turn start 时通过 `runtimeWorkspaceRoots` 接收完整且有序的 roots，但 Cypheria 不创建 Codex project、不发送原生 project ID，也不修改 Codex Thread 的 project metadata。Claude 通过 `options.additionalDirectories` 接收额外目录；声明 `session.additionalDirectories` capability 的 ACP Agent 则在 session new、fork、load 或 resume 时接收 `additionalDirectories`；两者都会先从 Project roots 中排除当前 `cwd`，剩余为空时省略该字段。OpenCode 只接收解析后的 `cwd`：创建时使用 `session.create.location.directory`，fork 与 resume 时通过 `session.move` 对齐 session directory。Cypheria 不向 OpenCode 发送 project metadata，也不创建或持久化 OpenCode project 映射。Pi 同样没有额外目录接口，因此每个 Thread 的 RPC 进程会使用解析后的 `cwd` 启动。

列表接口有上限并使用 cursor 分页。Mutation response 返回 Server 权威值，供客户端校正乐观更新。

## Canonical Timeline

只追加的 Canonical Timeline 是持久会话历史。每一行包含单调递增序号、时间戳、可选 turn ID、可选 harness item ID，以及一种判别 item：

- `message`：用户和助手内容；
- `reasoning`；
- `tool`；
- `plan`；
- `command`；
- `diff`；
- `approval`；
- `artifact`；
- `status`；
- `error`；
- `harness`：没有通用表示的 Agent 专属事件。

通用 item 可以包含 `harnessData`，用于来源和诊断，而不改变其共享语义。Harness-only item 保留 `agentId`、原生类型和已校验 payload，使客户端可以选择 harness 扩展。

由 Thread start 或 steer request 产生的 canonical 用户 `message` 会携带原始 `clientMessageId`。它是客户端乐观状态与 Agent 回显进行校正时使用的稳定公开身份。对应的 Agent 原生消息身份在内部以 `agentMessageId` 持久化，不属于公开 Timeline row。

Timeline cursor 包含 epoch 和 sequence。Epoch 用于检测历史替换或重建。读取支持 `tail`、`before` 和 `after`，并可请求 canonical rows 或 projected display items。Projection 会把同一 item 的后续 rows 折叠为稳定展示项，同时保留精确的源 sequence ranges。

客户端订阅 append notification，并在 replacement notification、cursor gap、重连或 epoch 不匹配后重新读取。持久化 Server Timeline 是历史与实时投影的唯一权威。

## Turns 与 interactions

Thread 输入是由文本、图片、音频、resource link 或 embedded resource 组成的有序列表，并受 Thread 公布能力限制。每个 start 和 steer request 都包含客户端生成的 `clientMessageId`。在同一 Thread 内，使用相同 operation 与内容重试同一 ID 时，Server 返回原 turn，不会再次提交给 Agent；用同一 ID 提交不同内容会以 `CLIENT_MESSAGE_ID_CONFLICT` 失败。

消息身份、执行身份和原生身份彼此独立：`clientMessageId` 标识已提交的用户消息，`turnId` 标识可包含 start 与 steer 消息的 Agent 执行，内部 `agentMessageId` 则标识所选 Agent runtime 中对应的消息。

Server 会在调用 Agent 前持久化 pending receipt，只有 canonical 用户 row 已持久化后才标记 completed。若进程或连接在 Agent 可能已接受消息后中断，后续重试会返回 `THREAD_MESSAGE_OUTCOME_UNKNOWN`，而不会冒险重复提交。客户端在传输重试时必须沿用同一 ID；遇到 unknown outcome 后，只有显式用户操作才能使用新 ID 再次发送。活动 turn 可以通过 Thread API 取消。

权限请求、问题和 MCP elicitation 会归一化为待处理 Thread interactions。Response 使用 allow、deny、selection、text、answers、elicitation action 或 cancellation 等判别结果。Harness metadata 保留原生上下文，共同生命周期保持统一。

## Harness catalog 与设置

`harness.management` capability 在不改变 `cypheria.v1` 传输版本的前提下暴露公共 catalog。`AgentModelDefinition` 描述 model、provider、thinking choices 和已校验 metadata。`HarnessSettingDefinition` 描述 `select`、`boolean` 或 `number` 值，`HarnessSettingSection` 以稳定 route ID 组织 definitions。`HarnessCatalogSnapshot` 携带 models、setting sections、加载状态、生成时间、stale 状态和刷新错误。其中 `authentication-required` 是没有刷新错误的正常协议结果，表示 harness 必须先完成认证，Server 才能发现 session-scoped catalog entries。

公开 Cypheria 协议版本与 ACP harness 连接版本彼此独立。Server 在 `initialize` 中优先提供 ACP v2，接受仅支持 v1 的 Agent 降级到 v1，并在该连接整个生命周期内绑定到协商出的消息 Schema。包括版本特定的 capability 布局、认证方法名称、prompt 完成语义和 v2 batch 在内的 ACP 原生细节，都保留在 Server adapter 后方。Adapter 代码从 `@cypheria/protocol/acp-adapter` 导入生成的逻辑 Schema、codec registry 和握手解析器；这些内容有意不从包根导出，也不进入公开 WebSocket union。ACP 逻辑 request 将原生方法参数统一放在 `payload` 下，只有 adapter 会把该 envelope 转换为 JSON-RPC `params`。

请求族包括 `harness.get`、`harness.auth.start/respond/poll/cancel/logout/test`、`harness.models.list` 和 `harness.settings.get/update`。`HarnessView` 声明 single 或 multiple provider cardinality，把互斥 method 嵌套在各 provider 下，并返回可单独寻址的 connection。Method 可以携带带类型、支持条件的表单字段 definition；login request 同时指定 provider 与 method，并且只提交该 method 已校验的 values。Logout 与连接测试则指定单个 connection。这些后端 operation 保留 login/logout 语义，而 Desktop 对用户呈现 Configure 与 Disconnect。`refresh: true` 是唯一由客户端触发的 catalog 刷新信号。认证 response 只包含 external URL 或 prompt 等展示状态；凭证只是 request 中的 secret，绝不出现在 snapshot 中。Server 会在持久化或应用到原生 runtime 前，按当前 catalog 校验设置更新。

## 错误与重连

传输和协议违规会关闭受影响连接。有关联的领域操作返回稳定错误码和可读消息。`@cypheria/client` 会把连接、能力、协议和 timeout 失败转换为专用错误类。

逻辑 session 由认证 principal 与 `clientId` 共同标识。在配置的 grace period 内重连会附着到保留的逻辑 session，但客户端仍须校正当前状态和 Timeline cursors。逻辑 session 不跨 worker 重启持久化。

## Client facade

`@cypheria/client` 是应用支持的入口。`createCypheriaClient()` 拥有一个连接；`createCypheriaApi()` 借用一个现有内部连接。当前 facades 为：

```text
client.agents
client.projects
client.threads
client.sections
client.timeline
client.harnesses
client.harnesses.codex
client.harnesses.claude
client.harnesses.pi
client.harnesses.opencode
client.harnesses.acp
client.schedules
client.web3
client.integrations
client.terminals
client.git
client.artifacts
client.settings
client.server
```

`client.harnesses` 上的公共操作覆盖所有 Agent 的 installation-adjacent state、认证、models 和类型化设置。具名 child facade 只暴露真实 harness 扩展。Codex Apps、guardian 和较底层的兼容操作仍位于 `harnesses.codex`；通用 integration 操作仍通过 `integrations` 提供。

该能力背后的归属与后端选择规则详见[本地 Git 设计](git.zh-CN.md)。

`git` capability 通过 Server Git 执行器提供本地仓库发现与初始化、不暴露远程 URL 的 origin provider 分类、状态、分支列表与上下文（当前、上游、默认、领先/落后提交数）、分支创建与切换、差异、暂存、取消暂存、提交、推送，以及托管 worktree 的列举、创建、删除和恢复。每个 `git.*.request` 都返回带关联 ID 的类型化成功值或错误。Git 操作使用 Server 所在主机的文件系统和 Git 安装。托管 worktree 位于 `CYPHERIA_HOME/worktrees` 下；Server 记录其仓库身份，并通过 `refs/cypheria/worktrees/*` 在删除后恢复已提交的 HEAD。列表包括可恢复的已删除 worktree。存在未提交改动时或目标为当前工作树时拒绝删除。
提交请求可选带 `includeUnstaged` 和经过校验的 `coAuthors` 字段。纳入未暂存改动时会先暂存全部本地改动；若暂存后发生错误，index 会保留以供恢复。Git 进程错误区分认证、拒绝、缺少上游、冲突、超时及无可提交内容。
经过认证的 `POST /api/v1/git/request` 端点为随程序分发的 MCP 工具进程接受同一套经校验的 Git 请求封装。
Server 以请求 ID 关联并审计 Git 修改请求的开始和结果。审计记录只包含操作类型和结果，不包含请求载荷或仓库路径。开始阶段的审计写入失败时，不执行修改。
`git.branch-comparison.request` 将 base 和可选的 head ref 解析为固定提交，返回两者的 merge base、领先/落后提交数，以及从 merge base 到 head 的逐文件增删行数。无效或不存在的 ref 会被拒绝，工作树不会被改动。
`git.index-entries.request` 返回指定路径的索引 mode、对象 ID 和冲突 stage。`git.submodule-paths.request` 从索引列出 stage 为零的 gitlink，包括尚未初始化的 submodule；两者都不会打开 submodule 工作树。
`git.text-blob.request` 将固定提交中的文件读取为 UTF-8 文本；非 blob、二进制数据及超过 1 MiB 的内容返回不可用。`git.blame-file.request` 返回仓库文件有上限的逐行归属信息，不返回文件内容。两者都拒绝仓库外路径。
`git.index-info.request` 返回当前工作树索引的毫秒修改时间；索引尚不存在时返回零，且不暴露索引路径。客户端可用它检测索引变化。
`git.worktree-job-start/read/cancel/retry` 返回有界的内存中创建状态（`queued`、`creating`、`setting-up`、`ready`、`failed` 或 `cancelled`）及 setup 输出。选定起点解析为源 HEAD 时，创建可复制已暂存、未暂存和未跟踪改动；远端起点在启用时会 best-effort 刷新上游。选定的环境配置须为仓库内的普通 JSON 文件，包含 `version: 1`、非空 `name` 和 `setup.script`，可用 `setup.darwin.script` 或 `setup.linux.script` 覆盖。Server 将文件复制到工作树，把工作树内路径写入专属 Git config，并在新工作树中运行脚本，注入 `CODEX_SOURCE_TREE_PATH` 和 `CODEX_WORKTREE_PATH`。setup 失败会保留工作树供重试或明确跳过；创建失败会清理新分配的工作树。
`git.worktree-move-thread.request` 可选择在源与目标 HEAD 相同且目标干净时复制本地改动。`git.synced-branch-state/sync/undo` 支持将托管 detached worktree 的变更受保护地同步到选定的本地分支。同步可通过临时 index 和合成提交纳入未提交文件，且不改变工作树 index；它会拒绝脏的源 checkout 或已在外部移动的分支，先前的分支提交保存在 `refs/cypheria/worktree-sync/*`，并更新 checkout 与元数据。撤销要求同步后的分支未再次变化。setup 只捕获少量白名单工具链环境变量的变化，将 `codex-shell-environment.json` 写入 worktree Git 目录；Server 在 Codex 线程启动、恢复和 fork 时通过 `shell_environment_policy.set` 传入捕获值，并保留这些值供恢复。
`git.availability`、`git.remotes`、`git.branch-exists` 和 `git.branch-commits` 提供有界的本地查询；远端身份不包含 URL 凭据。`git.apply-patch` 支持暂存、未暂存及组合目标、反向与二进制补丁、可选原子检查，以及使用临时 index 的未暂存三方应用。`git.apply-changes` 在找到 merge base 后，将源 tree 应用到固定的目标 HEAD。两者返回已应用、跳过及冲突的路径。`git.clone-state.request` 返回浅克隆与部分克隆状态。`git.worktree-starting-ref.request` 将选定分支或修订解析为固定提交。Git config 读写请求只允许操作工作树专属配置中的 `codex.localEnvironmentConfigPath`；启用工作树配置前，读取返回 null。`git.apply-review-sections.request` 按顺序执行最多 100 个固定文件修订的 Review 操作，逐项返回已应用、跳过、过期、冲突或失败结果，调用方可保留成功项并只刷新失败项。Server 短暂缓存仓库发现，并在 Git 修改或文件系统监视事件发生时失效。它广播 `git.repository-changed.notification`，让 Desktop 刷新 Git 和 PR 查询；不支持原生监视时，定期读取仍可作为后备。
GitHub PR 的可用性检查、列表、详情、创建、标题及正文编辑和合并使用 Server 所在主机的 `gh` 安装和当前 `gh` 账户。可用性分别报告 CLI、账户与当前仓库访问情况；PR 读取使用固定 JSON 字段，并在返回给客户端前校验结果。创建前检查 head 分支是否已有 PR，正文通过私有临时文件传入。合并要求传入当前显示的 head commit SHA，并使用 `gh --match-head-commit`。
GitHub App 按操作分别报告列表、账户范围检索、详情、差异、评论及审查、检查、审查线程、媒体和创建能力。可用的每组工具必须属于该仓库选定的同一账户 link。Desktop 只启用受支持的 App 读取；除创建外的 PR 修改由 `gh` 执行。PR 表单可创建并切换到新分支、选择提交本地改动并生成提交说明、推送分支、按保存的指令生成 PR 标题和正文，再通过选定后端创建。CLI 还提供跨仓库 PR 看板，可按状态、参与方式、文本及仓库筛选。创建结果不确定时，会刷新 PR 数据并提示用户在重试前查看 GitHub。
GitLab MR 的详情、按分支查找、讨论、reviewer 与批准状态、项目成员搜索、reviewer 管理、pipeline jobs 和 bridges、创建、标题更新及普通评论通过已连接 GitLab App 的 `codex_apps` 工具执行，要求关联本地 Codex 线程。`git.gitlab-mr-availability.request` 分别报告各操作组。Server 校验线程属于请求的仓库、origin 为 GitLab.com、项目和 MR URL 与 origin 一致，且所需工具绑定同一个 connector 账户 link。创建前要求当前分支与已推送的 `origin` 分支头一致；预填浏览器表单 URL 使用同一校验，且无需调用 connector。读取调用后会复核工具 resource URI；写入调用在发送前校验 link，并确认返回结果，不自动重试。Desktop 禁用不可用的 connector 操作，同时保留浏览器表单和本地分支推送路径。

## 校验规则

- 使用对应方向导出的 Schema 校验每个输入和输出边界。
- 不手写或复制生成的 Agent 协议类型。
- 不把 harness 原生消息 union 暴露为持久客户端状态。
- 在同一传输中保持在途 request ID 唯一。
- Cursor 在所属领域之外应视为不透明值。
- 可选行为必须使用 capability 和 feature negotiation。
