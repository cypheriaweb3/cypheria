---
title: 客户端与 Server 协议
---

# 客户端与 Server 协议

`@cypheria/protocol` 是公开 Cypheria 客户端/Server 契约的事实来源，导出严格 TypeScript 类型、编译后的 Zod 校验器、序列化器、能力常量，以及 Server adapter 内部使用的生成型上游产物。

## 范围

公开协议覆盖 Server 运维、Agents、Projects、Threads、Sections、Canonical Timeline、Integrations、Schedules、Terminals、Git 和 Web3。Agent 原生协议不是公开客户端 API，而是 `apps/server` 背后经过校验的 adapter 输入。

生成的 Codex App Server 文件位于 `packages/protocol/src/generated/codex/`。其[生成参考](../agents/codex-api.zh-CN.md)服务于 adapter 开发，不用于客户端直接调用。

## 传输

客户端通过 WebSocket subprotocol `cypheria.v1` 连接 `/api/v1/ws`。所有应用 frame 都是 WebSocket 二进制 frame；文本 frame 会被拒绝。普通协议消息使用由 `cbor2` 编码的确定性 CBOR。公开 CBOR profile 允许 null、boolean、string、有限 number、以 `number` 或 `bigint` 表示的整数、以 `Uint8Array` 表示的 byte string、array，以及仅使用 string key 的 map。值为 `undefined` 的可选对象属性会在编码前被省略；其他位置的 `undefined` 会被拒绝，且永远不会出现在 wire 上。该 profile 还拒绝自定义 tagged type、非 string map key、重复 key 和超过协议限制深度的结构。每个解码值仍会经过对应方向的 Zod Schema 校验。

高吞吐领域可以使用 raw-binary frame：首字节为 opcode，其余字节由对应领域 codec 定义。`0x01–0x0f` 保留给 terminal stream，`0x10–0x1f` 保留给 file transfer。接收方会先检查这些范围，再进入普通确定性 CBOR 协议消息的解码路径；其他 frame 都按普通协议消息处理。该分流没有歧义，因为每条有效的 Cypheria 顶层协议消息都是 CBOR map，其首字节位于互不相交的 map major-type 范围 `0xa0–0xbf`。raw frame 只能在正常 hello 握手完成后发送，领域 codec 会把单字节 slot 绑定到通过逻辑操作授权的 stream。终端 opcode 为：`0x01` 输出、`0x02` 输入、`0x03` resize、`0x04` ANSI restore。输入与输出 payload 为 `[slot, ...UTF-8]`；resize 为 `[slot, flags, cols:u16be, rows:u16be]`，claim bit 是 `0x01`；restore 为 `[slot, flags, ...ANSI]`，start bit 是 `0x01`，end bit 是 `0x02`。归属与恢复语义详见[终端](terminals.zh-CN.md)。

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

Agent management 会区分持久化 registry 与可用 harness catalog。`agent.list` 返回已注册 Agents 和当前可添加的 catalog entries，并包含各 entry 的可安装版本；已安装 Agent view 还会报告最终选择的 distribution 类型与来源。Registry ID 受当前 Cypheria release 从稳定 ACP 快照中生成并审核的子集 allowlist 约束。`agent.add` 只持久化一个 catalog entry，不执行安装。安装仍由显式 `agent.install` operation 完成，卸载会保留并禁用 registry 记录，`agent.remove` 用于删除未安装记录。Install 与 update operation 会报告从 `0` 到 `1` 的归一化进度，按 Agent 而非全局串行执行，并在版本切换时保留 active turn。只有 release 固定的 catalog 版本高于已安装语义化版本时，Server 才接受更新。

## 版本与能力

`CYPHERIA_PROTOCOL_VERSION` 控制传输兼容性。客户端必须拒绝无法安全消费的 Server 协议版本。`server.status.notification` 会发布稳定 capabilities 和可选 feature flags。客户端应据此控制可选 UI，而不是假设应用版本必然对应某个功能。

未知 feature flag 名称会被保留。同一协议版本优先采用可选字段的追加演进；不兼容的形状变更需要新协议版本。

## Projects、Threads 与 Sections

Project 组织 workspace roots 和有序 Thread membership。Thread 是持久 Agent 会话身份，包含 `agentId`、harness session 关联、状态、能力、待处理 interactions、最近时间、归档状态，以及可选 Project 或 Section 位置。Section 同时排序 Projects 和独立 Threads。

协议提供创建、读取、列表、更新、移动、membership、fork、rewind、归档和删除操作。顺序使用显式 position 和 `before...` 位置提示。固定 Pinned Section 由稳定协议常量表示；客户端不从 harness 元数据推断 Section 归属。

Project 与 Section membership 也作为规范化列表资源提供。Project membership 携带 `threadId`、`projectId`、position 与 timestamps；Section membership 携带 item reference、`sectionId`、position 与 timestamps。Project、Section 和 membership mutation 会发布类型化的 created、updated、upserted 与 deleted notifications，因此客户端可以维护规范化的本地 collections，而无需 N+1 membership 读取或轮询。逻辑删除 notification 会在 tombstone 提交后、延迟物理清理前发布；排序操作会发布所有受影响记录的规范 position。

`projects.roots` 是 Project 模板，`threads.roots` 则是 Thread 唯一的权威 workspace 状态；Thread 第一项 root 是其当前工作目录。创建 Project Thread 时会复制 Project 当时的 roots，之后编辑 Project 不会批量改写成员。`thread.workspace.sync` 可以在主要 root 不变且 Thread roots 仍是子集时执行静默的 additive sync，也可以执行用户确认后的 exact sync。活动 turn 会阻止 workspace 修改。Project 之间的移动会原子更新 membership 与 roots；移到 projectless 时则创建包含 `work/` 和 `outputs/` 的托管目录。Projectless Thread 移入 Project 后，只有在没有其他 projectless Thread 引用相同完整 roots 值时才删除旧托管目录。

Agent capabilities 会说明创建 Thread 后能否修改 cwd 与 roots。Codex 和 Claude 在 turn start 使用最新 Thread roots；Codex 接收 `runtimeWorkspaceRoots`，Claude 接收 cwd 与 additional directories。OpenCode 与 Pi 只暴露创建时工作目录，因此拒绝之后的 workspace 修改。Agent start、resume 与 reconnect 总是使用 Thread 当前 roots 初始化。Cypheria 不创建 provider 原生 Project，也不使用 provider session ID 作为 workspace identity。

`thread.files.*` 每次列出一层目录，按名称与路径搜索，读取有界 UTF-8 文本或二进制流，并提供带版本的写入、同 root 移动、隔离删除与冲突安全的恢复。每个请求都必须精确指定 Thread 的某个 root，并使用相对于 root 的路径。`thread.files.changed.notification` 用于失效受影响目录。`thread.paths.resolve` 把模型写出的路径（绝对路径、`~`、`file:` 或相对于工作目录的路径，可带 `#L12`、`#L12-L20` 或 `:12` 行号引用）解析为包含它的 Thread root 中相对于 root 的文件或目录，或报告该路径不存在、位于 Thread roots 之外；client 绝不会用自己的文件系统解释这类路径。`thread.workspace.cleanup.*` 只列出并显式删除无引用的托管 projectless 目录，绝不会自动发现或清理任意磁盘内容。

列表接口有上限并使用 cursor 分页。Mutation response 返回 Server 权威值，供客户端校正乐观更新。

Thread Attachments 是 Server 共享资源，不是 prompt 内容块或客户端偏好。`thread.attachment.list/add/remove` 管理 pull request 与托管 worktree 关系，`thread.attachment.owners.list` 提供反向查询，upsert/delete notifications 使各客户端保持同步。Pull request URL 由 Server 规范化为稳定的 provider/repository identity。Pull request 附件可以携带其检出的 `root` 和 `headBranch`；Agent 附加的 pull request 会记录 Thread 的工作目录和当前分支，不带检出再次附加时会保留已记录的检出。该契约使用 Cypheria Thread ID，适用于所有 Agent，不依赖 harness session ID。

`thread.workspace-thread.get/set` 读取和设置工作区页面在其 App 旁显示的聊天：插件全局页面的键是 `mcp-app:<入口>`，代码审查中 pull request 的键是 `code-review:<pull request 标识>`；null 表示在那里开始新聊天。`thread.workspace-thread.updated.notification` 通知所有客户端，删除 Thread 会清除该记录。

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

用户消息还可以保留原始有序 `input` blocks。选中的 `reference` 身份和不透明 `uploaded-file` ID 由 Server 在提交给 Agent 前校验与映射；普通文本绝不会被重新解释为已选引用。共享的候选查询、分块上传、读取和排队操作详见 [Composer 输入与引用](../desktop/composer.zh-CN.md)。

Timeline cursor 包含 epoch 和 sequence。Epoch 用于检测历史替换或重建。读取支持 `tail`、`before` 和 `after`，并可请求 canonical rows 或 projected display items。Projection 会把同一 item 的后续 rows 折叠为稳定展示项，同时保留精确的源 sequence ranges。

客户端订阅 append notification，并在 replacement notification、cursor gap、重连或 epoch 不匹配后重新读取。持久化 Server Timeline 是历史与实时投影的唯一权威。

`thread.summary.get` 是覆盖**完整** Canonical Timeline 的只读、可重建投影，不依赖客户端已加载的分页。它返回当前 epoch，以及 Outputs、Sources、Subagents 和最新 Plan 的总数与受限条目。条目只含稳定 item ID 和紧凑 metadata，不返回完整 diff、命令输出或二进制数据。客户端在 Timeline 更新或 epoch 替换后刷新此视图；它不是第二份历史存储。PR 附件、Schedules、Terminals 与设备本地 Browser tabs 仍通过各自 API 获取，并仅在客户端界面组合。

消息 row 带有显式操作边界。`turn-user` 可以 Rewind 或执行用户消息 Fork，`steer-user` 两者均不可用，`assistant-final` 只能 Fork。Assistant 流式 row 不带边界；turn 成功后，Server 会为最终 assistant 消息追加 completion replacement。失败或取消的 turn 不会获得 `assistant-final` 边界。Server 会针对当前 epoch 解析每个请求 cursor，并校验持久化 item，而不信任客户端声明的消息种类。

`thread.fork` 有三种 target。`thread-head` 复制完整 provider session；`user-message` 在该消息之前分支，并返回其完整 input blocks 供新 Thread composer 恢复；`assistant-message` 包含选中的已完成 assistant 消息，并返回空 composer。Fork 继承 source 的 Project 与普通 Section、排在 source 之后并记录 `forkedFromId`，但不继承 pinned、unread 或 archived 状态。`thread.rewind` 只接受 `user-message` target，保留 Cypheria Thread ID，替换 provider-session binding 与 Timeline epoch，并返回选中消息的 input blocks 给原 composer。两种操作都不会回滚 workspace 文件，不接受任意 Timeline item，也不会通过重放 prompts 近似 provider 不支持的边界。

分支成功 response 包含权威 Thread、完整的替换后 Timeline snapshot 与 composer input blocks。Provider 分支、session binding 和 Timeline 替换由持久 lifecycle journal 覆盖。启动恢复会完成已提交的 binding，或补偿尚未提交的 provider branch，且绝不会重新发送用户消息。

Archive 以本地状态为权威：Server 取消活动 turn、关闭 runtime、持久化 `archivedAt`，再尝试 provider 原生 archive。原生失败以 warning 返回，不撤销本地归档。Unarchive 先执行原生 restore，成功后才清除 `archivedAt`。Rename 先更新本地，再 best-effort 同步原生标题。`thread.archive_many` 独立执行每个单 Thread 操作，返回成功项、失败项与逐项 warnings，单项失败不会中断其余操作。

## Turns 与 interactions

Thread 输入是由文本、图片、音频、resource link、embedded resource、选中引用或已上传文件组成的有序列表，并受 Thread 公布能力及 Server 校验限制。每个 start 和 steer request 都包含客户端生成的 `clientMessageId`。在同一 Thread 内，使用相同 operation 与内容重试同一 ID 时，Server 返回原 turn，不会再次提交给 Agent；用同一 ID 提交不同内容会以 `CLIENT_MESSAGE_ID_CONFLICT` 失败。

消息身份、执行身份和原生身份彼此独立：`clientMessageId` 标识已提交的用户消息，`turnId` 标识可包含 start 与 steer 消息的 Agent 执行，内部 `agentMessageId` 则标识所选 Agent runtime 中对应的消息。

Server 会在调用 Agent 前持久化 pending receipt，只有 canonical 用户 row 已持久化后才标记 completed。若进程或连接在 Agent 可能已接受消息后中断，后续重试会返回 `THREAD_MESSAGE_OUTCOME_UNKNOWN`，而不会冒险重复提交。客户端在传输重试时必须沿用同一 ID；遇到 unknown outcome 后，只有显式用户操作才能使用新 ID 再次发送。活动 turn 可以通过 Thread API 取消。

权限请求、问题和 MCP elicitation 会归一化为待处理 Thread interactions。Response 使用 allow、deny、selection、text、answers、elicitation action 或 cancellation 等判别结果。Harness metadata 保留原生上下文，共同生命周期保持统一。

Context window usage 是瞬态 Thread runtime state，与 Timeline 历史、账户额度或计费配额分离。`thread.context.usage.get` 返回最新的统一 snapshot，`thread.context.usage.updated` 发布变化。每个 snapshot 都包含已用、剩余与最大 token、百分比、观测来源、可选 model 与 cost，以及按 Agent 判别的专属明细。Server 不持久化这些 snapshot。

## Harness catalog 与设置

`harness.management` capability 在不改变 `cypheria.v1` 传输版本的前提下暴露公共 catalog。`AgentModelDefinition` 描述 model、provider、thinking choices 和已校验 metadata。`HarnessSettingDefinition` 描述 `select`、`boolean` 或 `number` 值，`HarnessSettingSection` 以稳定 route ID 组织 definitions。`HarnessCatalogSnapshot` 携带 models、setting sections、加载状态、生成时间、stale 状态和刷新错误。其中 `authentication-required` 是没有刷新错误的正常协议结果，表示 harness 必须先完成认证，Server 才能发现 session-scoped catalog entries。Thread create 可选接收完整 `config`；`thread.config.update` 接收局部 patch 并返回修改后的权威 Thread。字段包括 `model`、`thinking`、`speed` 与 `permissionsMode`。新 Thread 的缺省值来自 harness 与 Server 默认值，已有 Thread 则不会回退到后来变更的默认值。

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
client.extensions
client.codeReview
client.magpie
client.browserHost
client.computerHost
client.settings
client.server
```

`client.harnesses` 上的公共操作覆盖所有 Agent 的 installation-adjacent state、认证、models 和类型化设置。具名 child facade 只暴露真实 harness 扩展。Codex Apps、guardian 和较底层的兼容操作仍位于 `harnesses.codex`；通用 integration 操作仍通过 `integrations` 提供。

`client.terminals` 可列出、创建、重命名、关闭和 capture Thread 终端，监视共享 Thread 目录，并观察已授权的二进制 stream。认证 flow 会暴露一个只能由所属逻辑客户端 session 观察的私有终端 ID。完整契约见[终端](terminals.zh-CN.md)。

`client.magpie` 覆盖 `magpie` 能力：AI 网关的状态与生命周期、其 Agent、提供方、路由组与用量。规则见 [AI 网关](ai-gateway.zh-CN.md)。

`git` capability 通过 Server 的 Git 执行器运行本地仓库、Review、提交、推送、工作树和创建拉取请求等操作。其请求及规则见 [Git](../features/git.zh-CN.md#协议)；读取和审查拉取请求不属于该能力。

`client.extensions` 覆盖 `extensions` 能力：插件 extension catalog、MCP App 实例及其请求、模型上下文、结构化设置、提及，以及 extension 调用产生的表单；消息列表见 [Plugin Extensions](../agents/plugin-extensions.zh-CN.md#协议)。App 文档以每段最多 200,000 个字符分段到达，因此中继的消息上限不会截断它。`client.codeReview` 覆盖 `code-review` 能力：`codeReview.setup.get` 报告 ChatGPT 登录状态及 GitHub、GitLab 连接，`codeReview.provider` 为 App 的宿主请求执行固定列表中的某个 GitLab 或 GitHub 后端操作，`codeReview.tool.call` 为没有 App 的宿主界面调用某个 `pull_requests.*` 工具，`codeReview.pullRequests.list/save/remove` 保存提供方账户已固定和最近打开的拉取请求，并以 `codeReview.pullRequests.changed.notification` 通知变更。工具、App 和宿主扩展见[代码审查](../features/code-review.zh-CN.md)。

## Computer Use host

Computer Use 通过两种 host 注册到达 Desktop，按所提供内容的归属划分。两者都只存在于 Server 内存中：client 和 host 都不持久化；Server 重启后，或重连超过 session 宽限期后，每个 client 都会重新注册。

**Browser host** 是一个窗口：它的内置浏览器标签页和它显示的 MCP App。具备 `browser` capability 时，`client.browserHost.register()` 发送 `browser.host.register.request`，其中包含设备名称和该窗口提供的浏览器后端（`iab`、`mcpapps`）；每次重连后和调用 `refresh()` 时重新注册，并以 `browser.host.unregister.request` 释放。只有 `desktop` session 可以注册。每个窗口都在自己的 transport 上注册，Server 为每次注册分配独立的 host ID，即使多个窗口共用一个 client ID 也是如此，因此每个窗口保有自己的标签页和 App；关闭 transport 会移除该窗口的 host。

**Computer host** 是设备：用户的 Chromium 浏览器和本机原生应用。具备 `computer-host` capability 时，`client.computerHost.register()` 发送 `computer.host.register.request`，其中包含设备名称和它提供的能力（`chrome`、`computer`）；每次重连后和调用 `refresh()` 时重新注册，并以 `computer.host.unregister.request` 释放。只有 `desktop` session 可以注册。Server 以 client ID 作为该 host 的键。Desktop 从 Electron main 注册它；与每个窗口一样，Electron main 的连接使用 Desktop 为该 Cypheria home 保留的 client ID，因此它们都加入同一个 session，设备的 browser host 和 computer host 属于同一台设备。若某个 client 的多个连接都注册了它，请求会发往仍连接的最新一个；最后一个连接关闭时该 host 消失。设备如何驱动其 `chrome` 浏览器是设备自己的设置，不属于注册内容，也不出现在任何请求中。

Server 为每个窗口请求发送一条 `browser.automation.command.notification`，其中包含 automation ID、后端、请求，以及调用方 Thread 的 ID 和工作目录。窗口用 `browser.automation.result.request` 回应，携带结果值，或带有错误码、消息以及是否可重试的错误。对于设备请求，Server 发送 `computer.host.command.notification`，其中包含 command ID、请求，以及调用方 Thread 的 ID 和工作目录；设备以相同结构的 `computer.host.result.request` 回应。两者的请求都是 record，其语法由 `@cypheria/cua` 定义：浏览器成员调用写明浏览器、提供它的后端、成员及其参数，以及它所作用的标签页、locator 或下载与文件选择器句柄；设备请求另有原生应用请求，以及 `device.turnEnded` 和 `device.closeThread` 通知。Server 在发送前校验每个请求，窗口或设备会再次校验。

设备执行命令期间，可以用 `computer.host.approval.request` 请求 Thread 中的用户批准，其中写明 command ID、Thread、风险等级、是否可以在该 Thread 之外长期允许，以及要操作的应用，或以 `kind: "audio"` 表示录制电脑音频；`client.computerHost.requestApproval()` 发送它。Server 只接受针对它发给该设备、属于该 Thread 的命令的请求，在该 Thread 中发起一个任何客户端都能回答的 `permission` 交互，在有人回答之前暂停该命令的截止时间，并以携带 `session`、`always` 或 `deny` 的 `computer.host.approval.response` 回应。关闭、回退或中断该 Thread 会取消这个问题，设备将其视为拒绝。

`CuaHost` 跨 host 列出浏览器，解析 ID 和别名，按浏览器类型检查每个成员，并路由调用：内置浏览器调用发给拥有该标签页的窗口，新标签页发给发送该 turn 的设备的最新窗口，MCP App 调用发给显示该 App 的窗口，`chrome` 调用发给上报该浏览器的设备。尚无窗口认领的标签页（例如重连之后）会先向每个窗口查询其标签页来定位。因超时（窗口请求 15 秒，设备请求 120 秒）或断开连接而未获回应的请求会失败；只有只读成员和可重复的设备请求会标记为可重试，其他请求的错误会说明它可能已经执行。Agent 通过 `cua_repl` 访问这两种 host，详见 [Computer Use](../features/computer-use.zh-CN.md#host)；每个请求都带有其 host socket 所属的 Cypheria Thread，窗口会拒绝针对其他 Thread 标签页或 App 的请求。每个请求都按 Server 配置中的 `computerUse` 检查后端和界面开关。会改变状态的调用以 `cua.<operation>` 事件审计，记录 Thread 和目标，不记录参数或页面内容。

## 校验规则

- 使用对应方向导出的 Schema 校验每个输入和输出边界。
- 不手写或复制生成的 Agent 协议类型。
- 不把 harness 原生消息 union 暴露为持久客户端状态。
- 在同一传输中保持在途 request ID 唯一。
- Cursor 在所属领域之外应视为不透明值。
- 可选行为必须使用 capability 和 feature negotiation。
