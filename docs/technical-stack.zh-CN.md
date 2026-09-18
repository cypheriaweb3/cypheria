# Cypheria 技术选型

Cypheria V1 是一个 TypeScript Web3 agent 产品，由一个特权 server 与 desktop、Expo、web、mobile、CLI、SDK clients 组成。它复用 Codex 承载 agent 工作流，并在 server 边界后实现 Cypheria 自有 Web3 能力。

## 平台选型

| 分类 | 选型 |
| --- | --- |
| Primary languages | TypeScript；relay 数据面使用 Go 1.25 |
| Monorepo | Turborepo |
| Package manager | pnpm |
| Lint / format | Biome |
| Tests | Vitest、Testing Library、Playwright |
| Runtime validation | Zod |
| Server | Node.js 上的 Hono 4、`@hono/node-server`、`ws`、Pino |
| Relay | Go、`coder/websocket`、etcd client v3、内部 TLS 1.3 mTLS |
| Relay E2EE | `tweetnacl`、X25519、XSalsa20-Poly1305、`base64-js` |
| Relay 可观测性 | OpenTelemetry SDK、OTLP/gRPC metrics/traces、外部 Collector |
| Server build 与进程模型 | tsdown、supervisor/worker、PID lock、heartbeat、有界 restart |
| Client protocol | `@cypheria/protocol`、Zod、HTTP + WebSocket `cypheria.v2` |
| 跨平台 client | Expo SDK 57、Expo Router、React Native 0.86、React 19 |
| Expo web output | 内置到 server build 的静态 Metro export |
| Desktop runtime | Electron |
| Frontend app | TanStack Start |
| Router | TanStack Router |
| Server/cache state | TanStack Query |
| UI state | Jotai |
| Forms | TanStack Form + Zod |
| Desktop 国际化 | Lingui 与已提交的 PO catalogs |
| Desktop build | Renderer 使用 Vite，Electron main/preload 使用 tsdown |
| Desktop packaging | electron-builder |
| CLI/SDK 目标 integration | Cypheria server protocol |
| Desktop agent integration | 通过 `@cypheria/ai-sdk-provider` 与 `@cypheria/client` 使用 AI SDK 7 |
| Codex protocol types 与 validation | `pnpm --filter @cypheria/protocol generate:codex-all` |
| ACP bridge | `@agentclientprotocol/sdk@1.4.0` app API，通过 `@ai-sdk/provider` 4.x 的 `LanguageModelV4` 接口接入 AI SDK 7.x |
| 公开 agent protocol | Provider-neutral 的 `agent.*` 管理与 `thread.*` execution |
| 内部 provider adapter | Codex、Claude Agent SDK、Pi RPC、OpenCode SDK 与 ACP |
| OpenCode | Registry binary `1.18.30`、`@opencode-ai/sdk@1.18.31`、共享 loopback server |
| 受管 agent 工具链 | 最新稳定 Node LTS、uv 管理的稳定 CPython、uv/uvx |
| Marketplace web runtime | Cloudflare Workers 上的 TanStack Start |
| Marketplace data | Cloudflare D1 system of record、R2 immutable artifact、Queues、Workflows |
| Local database | SQLite |
| ORM | Drizzle ORM |
| SQLite driver | libSQL 本地 SQLite 入口（`@libsql/client/sqlite3`） |

## Workspace 结构

```txt
apps/cli
  无 TUI 的命令行应用。

apps/expo
  面向 iOS、Android 与静态 web 的 Expo Router 应用。

apps/server
  Hono control plane、runtime host、静态 web host 与 supervised server。

apps/relay
  支持单进程和集群 gateway/worker 运行形态的 Go relay。

apps/desktop
  ipc/
  main/
  preload/
  renderer/
apps/marketplace
  部署到 Cloudflare Workers 的 TanStack Start 应用。

packages/sdk
packages/client
packages/protocol
packages/relay
packages/ai-sdk-provider
packages/web3
packages/ui
packages/db
```

`packages/sdk` 仍是规划中的 package。`apps/cli`、`apps/server`、`apps/desktop`、`apps/expo`、`apps/marketplace`、`packages/client`、`packages/protocol`、`packages/web3` 与 `packages/ai-sdk-provider` 已实现 client/server 基础。原 runtime、Codex bridge、ACP provider、automation 与拆分的 Web3 package 已并入目标边界并删除。

`@cypheria/protocol` 使用 Zod 编写 live public Agent/Thread、project/section 与 server WebSocket contract，同时持有供内部 server adapter 使用的 generated Codex App Server 产物及固定版本 ACP、Claude、Pi schema。这些 provider catalog 接受 drift check，但不进入 public client/server message union。Live wire 暴露 provider-neutral 的 `agent.*` 管理与 `thread.*` execution；`threadId` 是唯一操作句柄，`agentSessionId` 只是只读元数据。

Provider schema 保留精确上游 type 与 runtime validation，但不成为公开路由 surface。`ThreadProviderAdapter` 把 provider history 与 streaming event 转换为 canonical timeline row，把 permission/question API 映射为 typed Thread interaction，并隐藏 provider process/session ownership。Codex 与 OpenCode process 共享，Claude、Pi 与 ACP execution 按 Thread 隔离。

Timeline 连续性由 server-owned SQLite canonical log 实现。Epoch metadata 与 canonical row 会先以事务提交，再广播 notification；只有已提交 row 在 epoch 内获得连续 sequence。Provider history replacement 会创建新 epoch，projected page 保留精确 canonical source range，server 重启后会重新打开同一 timeline。Permission 仲裁只接受首个合法 client response。

Agent management 使用临时 ACP Registry 输入生成并提交静态 ID、每小时条件刷新并把 Registry 保存到 `$CYPHERIA_HOME`、记录版本和元数据的 SQLite `agent_registry` 表、异步安装 operation 与显式 enable。受管 Node/Python/uv 版本和按依赖指纹共享的不可变 Python environment 全部位于 `$CYPHERIA_HOME` 下。详见 [Agent 管理](agent-management.zh-CN.md)。

`@cypheria/client` 依赖 `@cypheria/protocol` 与只处理传输的 `@cypheria/relay`。它的 `ServerClient` 实现可注入 transport boundary、browser 与 Node WebSocket adapter、hello/authentication、请求关联、超时、protocol validation、typed error、事件投递与有界重连。`CypheriaApi` 是不带 lifecycle 的借用门面；`CypheriaClient` 持有一条连接。首选门面是 `agents`、`projects`、`sections`、`threads`、`timeline` 与 `schedules`；单数 `agent`/`thread` 和组合式 `projectThread` 在客户端迁移期间作为兼容别名保留。Provider-specific client subpath 仍不公开；所有 client 观察同一个 server-owned Thread 状态与 notification。

Schedules 是 Server service，而不是 Desktop timer。SQLite 保存 cadence、target、下一执行时隙、乐观 revision、lease 与独立 run record。Server 在 dispatch 新 Thread、已有 Thread turn 或受限 Web3 runtime method 之前，以一个事务推进已领取时隙并创建 run。启动时会把未完成 run 标记为 interrupted、清理 lease，但不回退 schedule，从而避免自动重放中断的签名或交易发送。Cron 实现使用五字段表达式和 IANA 时区；错过的 interval 与 cron 时隙会前进到下一个未来时间，而不会产生无界积压。

带关联 ID 的 facade call 共享 `{ signal, timeoutMs }` 控制；deadline 先发生时，仍在等待懒连接
的 send 会被取消。写入 transport 前会根据逻辑 `server.status.notification` 检查所需 server capability。
Codex connection 会完成显式的 per-client initialize/initialized 状态机，反向 RPC failure
通过本地 handler-error hook 报告。

`@cypheria/client` 还接受与直连配置互斥的 `relayOffer`。它通过 `@cypheria/relay` 在现有
Cypheria 顶层 `hello` 之前完成 E2EE。`apps/relay` 使用 Go 1.25；`--mode=single` 在单进程内
组合 gateway、worker 与 memory coordinator，不需要 etcd，但必须严格只有一个副本。
`--mode=cluster` 拆分 gateway 与 worker role，并增加 etcd v3 lease、rendezvous ownership 和
内部 TLS 1.3 双向认证。仓库提供 TOML 配置和 Kustomize base，etcd 与 Collector 仍由外部提供。
两个模式都使用 `coder/websocket`、显式加权入口内存预算和容器感知 Go 内存上限。
进程只通过 OTLP/gRPC 导出 metrics 和短生命周期 routing span，不提供 Prometheus endpoint。
详见 [Cypheria Relay](relay.zh-CN.md)。

`@cypheria/ai-sdk-provider` 是建立在 `@cypheria/client` 之上的 browser-safe AI SDK v4 门面。
Codex、Claude、Pi、OpenCode 与 ACP 入口共用同一个 Thread-backed 实现：调用会创建或恢复
Cypheria Thread，turn 消费 canonical Timeline notification，abort signal 会取消 server turn，
agent/type/thread provenance 则保存在 provider metadata 中。默认使用持久化 Thread；ephemeral
模式会在调用完成后显式删除由本次调用创建的 Thread。该包不导入 provider SDK、不启动进程、
不读取文件，也不维护第二份会话存储。

## Server 与 Expo 技术栈

`apps/server` 使用 Hono 而不是 Express。Hono 负责 JSON route、validation middleware、严格 API fallthrough、static file 与 WebSocket upgrade route。Node adapter 让一个 HTTP listener 与 `ws` no-server instance 共用端口。Transport-neutral session state machine 接受 Paseo 形态的顶层 `hello`、`ping`、`pong` 与 `session` envelope，以 principal 加 client ID 作为逻辑 session key，支持同时挂接多条 transport、按来源关联 response、限制 frame、广播 runtime event，并暴露 server information、diagnostics、runtime forwarding 与 lifecycle request。

Server 分为 supervisor 与 worker process。Supervisor 持有 PID record、双向 heartbeat watchdog、crash budget、restart backoff、process-group termination 与 signal；worker 持有 `CypheriaRuntime`、逻辑 client session、持久化 server config、relay ingress 和 network listener。两者都向 `$CYPHERIA_HOME` 下追加结构化 Pino log。详见 [Cypheria Server](server.zh-CN.md)。

`apps/expo` 对 web 使用 Expo Router static output，并由同一套 route/component 构建 iOS 与 Android。Expo 的 monorepo-aware Metro setup 无需手工配置 watch folder 即可解析 workspace package。Server build 依赖 Expo build，并把完整 `dist` tree 复制到 `apps/server/dist/web`；Hono 使用 SPA fallback 提供这些文件。

## Marketplace 技术栈

`apps/marketplace` 是部署到 Cloudflare Workers 的 SSR-first TanStack Start 应用，复用 `@cypheria/ui`、TanStack Router/Query/Form、Zod、Drizzle 与 Lingui。自定义 Worker entrypoint 将 HTTP request 委托给 TanStack Start，并提供 public、publisher、reviewer 和版本化 Desktop API 界面。

D1 是 identity、GitHub source、draft、scan、review、release、publication、advisory 和 audit event 的 source of truth。R2 保存默认私有的不可变 evidence 与 public asset。Queues 分发有界 job；Workflows 编排 source scanning、人工 review 和 publication。最小权限 GitHub App 将 active release 确定性同步到 Cypheria 官方 repository 的 `.agents/plugins/marketplace.json`。只接收由 commit SHA 固定的 public open-source GitHub `url` 与 `git-subdir` source。Desktop 使用 Marketplace API 发现，并通过 App Server Git marketplace operation 安装。详见 [Cypheria Marketplace 设计](marketplace.zh-CN.md)。

## Runtime Stack

the `apps/server` runtime 是 Cypheria 自有非 agent services 的 TypeScript host。它应该组合 domain packages，而不是重复定义它们的模型。

Runtime 职责：

- 解析 `$CYPHERIA_HOME`，默认 `~/.cypheria`。
- 派生 `CODEX_HOME=$CYPHERIA_HOME/codex`。
- 初始化 runtime directories。
- 连接 database、audit、wallet、policy、browser、schedule 和 settings services。
- 向 `apps/server` 暴露 typed request/event API。

Runtime 不实现 Codex agent internals。

## CLI Stack

`apps/cli` 是无 TUI Node CLI。它依赖 `@cypheria/client` 与共享 Cypheria protocol，并连接 `apps/server`。

它不得依赖：

- `@cypheria/sdk`
- the `apps/server` runtime
- the Server Codex adapter
- Electron 或 desktop packages

已实现命令行为：

- `cypheria server start|stop` 委托给已安装的 Server supervisor CLI。
- `cypheria server status` 使用版本化 client handshake 与 status API。
- `cypheria server logs` 读取 `$CYPHERIA_HOME` 下的 Server log 尾部。
- Agent、Project、Thread 与 Schedule 列表使用公开的 `@cypheria/client` facade。

## SDK Stack

`@cypheria/sdk` 是规划中的公共 TypeScript server client，面向 Node 与兼容的 JavaScript 应用。它依赖 `@cypheria/protocol` 与 transport implementation。

它不得依赖：

- `apps/cli`
- the `apps/server` runtime
- Electron 或 desktop packages
- the Server Codex adapter

SDK clients 应该是版本化 server operation 与 event stream 之上的轻量 wrapper。

## AI SDK Provider Stack

`@cypheria/ai-sdk-provider` 通过 AI SDK 7 的 `LanguageModelV4` contract 暴露 browser-safe 的 Codex、Claude、Pi、OpenCode 与 ACP providers。每个 provider 只依赖 `@cypheria/client`、`@cypheria/protocol` 和 AI SDK 公共类型；不会启动进程、读取 provider 文件或导入原生 Agent SDK。持久模式绑定 Cypheria Thread，显式临时模式让 server 创建 Thread，streaming 消费 canonical timeline event，abort 则取消对应的 server turn。旧 Node-side ACP transport 实现只在 ACP execution ownership 完全迁入 `apps/server` 前过渡保留。

## Desktop Stack

Desktop 保留 Electron + TanStack Start，以及精细对齐 Codex Desktop 的交互模型。Electron main 现在会在打开 renderer 前发现、复用或启动 bundled 且 protocol-compatible 的 Cypheria server。共享 Sidebar 与会话数据通过 `@cypheria/client` 获取；typed Electron IPC 继续承载 browser、secure storage、window、update、terminal 和 OS-only 能力，其余特权 service 在迁移期间逐步搬入 server。

桌面内部导航使用 TanStack Router 链接，保留当前文档、全局样式和外观状态。全局 CSS 在客户端 hydration 之前由根文档链接加载。对话查询参数由首页路由校验；切换对话或点击 New chat 会重置对话会话，而不重新加载整个应用。

Search 在当前页面上打开 shadcn Command 对话框，支持防抖对话搜索、最近对话、键盘选择，以及加载、错误和空结果状态。关闭对话框保留当前草稿，选择结果则导航至对应对话。

| Area | Choice |
| --- | --- |
| Main process | TypeScript built with tsdown |
| Preload | TypeScript built with tsdown |
| Renderer | TanStack Start built with Vite |
| Production renderer transport | 带 SPA fallback 的 privileged standard Electron `cypheria://` protocol |
| IPC | 位于 `apps/desktop/ipc` 的 Zod-validated contracts |
| Renderer state | Jotai + TanStack Query |
| Renderer 国际化 | Lingui（`@lingui/core`、`@lingui/react`、CLI 与 Vite catalog compilation） |
| UI primitives | `@cypheria/ui` |
| Codex process | `codex app-server` |
| Codex transport | localhost WebSocket JSON-RPC |
| Codex protocol types | generated into `packages/protocol/src/generated/codex/ts` |
| Codex protocol schemas | generated into `packages/protocol/src/generated/codex/schema`，并适配为逐消息 Zod schema |
| Codex 派生注册表 | 生成到 `packages/protocol/src/generated/codex/messages.ts` 与 `response-map.ts` |

Electron browser defaults：

```ts
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
}
```

Renderer 使用 `@cypheria/client` 访问共享产品数据，只把 Electron 专属 browser、window、terminal、secure-storage、update 与 OS integration 留在 typed IPC。Agent 与 Web3 lifecycle 属于 Server。

语言选择器位于常规设置页。

Desktop 提供 Codex 风格的可搜索语言选择器。偏好与 appearance、workspace layout 一起持久化到 Electron 本地的 `$CYPHERIA_HOME/desktop/desktop-settings.json`，不再属于 Codex 配置。Electron 根据 preferred-language list 解析自动检测，通过 preload bootstrap 传入偏好与最终 catalog locale，并通过 typed IPC 广播后续变更。由于打包后的 SPA shell 在构建时预渲染，服务端输出与首次客户端渲染统一使用英语 source catalog；hydration 完成后，renderer 立即激活 bootstrap catalog，同步 document 的 `lang` 与 `dir` 属性，并在不重载页面的情况下切换语言，从而避免 locale 导致的 hydration mismatch。英语与简体中文随包提供 catalog；其他选择当前保留原始选择，但界面回退英语。PO 文件提交到仓库；`pnpm --filter @cypheria/desktop i18n:extract` 用于更新 catalog，`i18n:compile` 用于严格校验翻译完整性。

设置导航分为“个人”“集成”“编码”和“已归档”，并按本地化后的目标名称筛选；`Cmd/Ctrl+F` 可以在任意设置路由聚焦搜索。已归档聊天路由通过 `archived: true` 分页调用 `thread/list`，把查询作为 `searchTerm` 交给 App Server，并经由 main/preload 边界暴露 typed `thread/unarchive` 与需要确认的 `thread/delete` 操作。缺少 Codex App Server 或 Cypheria 自有后端的 ChatGPT 服务设置保持在范围之外，不显示成无法工作的空壳控件。

Desktop main bundle 将 `@libsql/client` 及其 platform packages 保持为 external，使 Electron 在运行时加载匹配的 native binary。`build:main` 会把已提交的 Drizzle migrations 复制到 `dist/drizzle`，因此 packaged startup 与 tests、development 使用同一 migration source。应用 ready 之前，Electron user/session data 会以 `$CYPHERIA_HOME/browser` 为根目录。

## Codex 集成

Server 为每个 client 持有 Codex。Desktop 的实时 turn 与持久 history 已通过统一 provider 与 canonical Thread 接口进入。以下 direct bridge 只在 desktop-only 的 Codex 配置、插件、技能、MCP、终端与审批 surface 获得共享 server API 前过渡保留：

```txt
Desktop
  -> apps/server Codex adapter
  -> codex app-server over WebSocket JSON-RPC
```

the Server Codex adapter 只负责 desktop 集成。它应该：

- 从 `@cypheria/protocol/codex-types` 消费原始 generated Codex app-server type，并从 `@cypheria/protocol` 消费 Cypheria message contract。
- 由 `@cypheria/protocol` 持有 protocol generation 与 schema；`pnpm --filter @cypheria/protocol generate:codex-all` 始终包含 experimental API，把从 Rust 64 位整数生成的声明规范化为 JSON wire type `number`，为 generated relative import 补齐 TypeScript extension 以兼容 NodeNext consumer，并刷新 dotted message schema 与 API 参考文档。
- 使用 protocol 持有的 request/response mapping；在 bridge 改为围绕 protocol dotted message 与 Zod schema 工作之前，暂时在 bridge 内校验原始 response、反向 request 与 notification。
- 实现 WebSocket transport。
- 执行 `initialize` request 和 `initialized` notification handshake。
- 关联 JSON-RPC requests 和 responses。
- 流式处理 server notifications。
- 将 approval、user-input、MCP-elicitation 与 experimental dynamic-tool server request 路由到 Electron main。
- 处理 disconnect 和 overload errors。
- 暴露 AI SDK `ProviderV4` adapter，供需要 AI SDK / AI Elements streams 的聊天界面使用，同时保留直接 bridge request API 给非 AI SDK 调用方。
- 适配器实现 `LanguageModelV4`，声明 `specificationVersion: "v4"`，要求 Node.js 22 或更高版本。
- `LanguageModelV4` 输入保留 text、inline/local image、受支持的 inline/local audio 与 inline text file。Remote media 尽可能由 AI SDK normalization；无法解析的 remote URL、provider file reference、含糊的 image type 和不支持的 media 会返回 warning。
- 顶层 `reasoning` 映射到 Codex turn effort；显式 Codex `reasoningEffort` 设置优先，`provider-default` 不指定 effort。各推理级别是否受模型支持由 Codex 决定。
- Streaming output 保留有序 text/reasoning、provider-executed command/file/MCP/dynamic/collaboration/web tool、preliminary progress、作为 file 的 generated image、web source、token usage、metadata、不可重试的 App Server failure 与 transport failure。Reasoning start/end chunk 会成对且去重，包括内容为空的已完成 reasoning item，避免 AI SDK 因 unmatched end 主动取消 stream。兼容 part 会在 provider metadata 中携带完整 Codex item projection。并行的 `CodexTurnProjector` 为 turn envelope、每个完整 generated `ThreadItem`、生命周期、累计 progress、terminal interaction、turn plan/diff update、model reroute 与其他未映射的 turn-scoped notification 生成 typed persistent UI data parts。
- Persistent thread resume 默认继承已存的 approval 与 sandbox policy，只有显式提供时才覆盖。Abort 使用 `turn/interrupt`；active session 可以使用 `turn/steer`，也可以直接开始后续 turn。
- AI SDK tool definition 不会被当作 App Server dynamic-tool callback。Electron-main service 在 `CodexDynamicToolRegistry` 中注册 experimental dynamic-tool schema 与 handler；schema 随 `thread/start` 发送，`item/tool/call` 由 registry 分发到对应 handler。
- 无状态历史将 `LanguageModelV4` 工具结果内容转换为文本（文件 URL/标签仍是文本）。二进制/引用工具文件、自定义工具内容、助手自定义内容及推理文件无法原生重放，会返回警告。

Direct bridge 是 application capability plane。Thread、project、review、account、login、plugin、skill、MCP、terminal、configuration 和未来 App Server capability 的 generated stable/experimental method，均继续保留在 typed request API 中，而不是强行塞进 `LanguageModelV4`。Electron main 只把需要暴露给 renderer 的 operation 包装成收窄的 typed IPC service。Desktop initialize 时设置 `experimentalApi: true`。Reverse request 使用 typed fail-closed interaction broker：handler 缺失、response 无效、timeout、disconnect 和 shutdown 都不会被解释为批准，用户 decision 会写入 audit。只有具备真实 attestation implementation 后才声明该能力；App Server-managed authentication 不需要外部 token-refresh callback。

完整的 generated method 清单见 [Codex App Server API 参考](codex-app-server-api.zh-CN.md)。

Electron main 拥有 `codex app-server` child process。它选择 localhost port，以 `CODEX_HOME=$CYPHERIA_HOME/codex` 启动进程，等待 WebSocket handshake readiness，通过 `codex.event` 转发 renderer-safe Codex summaries，记录 stderr，并随 runtime 一起关闭进程。Workspace 与 desktop manifests 精确固定 `@openai/codex` 版本。Development 解析该 package，而不是用户的 `PATH`；packaged build 解析 `resources/codex/codex`（Windows 为 `codex.exe`）。`CYPHERIA_CODEX_PATH` 是显式 diagnostic override。Desktop 在启动 App Server 前检查 `codex --version` 是否与生成 committed protocol types 的版本一致。

在 Electron ready 之前，desktop 会关闭 Chromium 的 `CompressionDictionaryTransport` 与 `CompressionDictionaryTransportBackend` features。Cypheria 不依赖共享 HTTP 压缩字典，关闭这项可选 transport 可以避免 `$CYPHERIA_HOME/browser` 下不兼容或因中断而残留的 Chromium disk-cache 状态反复产生启动警告；普通 HTTP 缓存和 browser profile 的其他部分仍保持启用。

通过以下命令生成 protocol types：

```sh
pnpm codex:generate
```

Generated files 需要提交，这样 CI 和贡献者不必为了 typecheck 而拥有完全匹配的本地 Codex binary。Codex `generate-ts` 继续作为 authoritative TypeScript source。Protocol package 把 generated JSON Schema definitions 包装成 OpenAPI 3.1 input，交给固定版本的 `@hey-api/openapi-ts`，提交 815 个静态 Zod 4 schema，并在 build、test 与 typecheck 前检查 generated output。预处理保留真正名为 `default` 的字段，只删除会导致 parse-time mutation 的 schema default annotation，并把 Rust 64-bit integer format 映射为 JSON wire type `number`；custom object resolver 保留 JSON Schema 的 strict、open 与 typed additional-property 行为。随后 Cypheria-specific generator 把这些 definition validator 组合成每个 `agent.codex.*` request、response 与 notification schema。升级 Codex 时，必须在同一 change 中更新两处精确 dependency declaration、更新 `CODEX_APP_SERVER_VERSION`、重新生成这些文件，并运行 bridge 与 desktop tests。

## UI Stack

UI 策略是复用成熟 primitives，只为 Cypheria-specific workflows 构建自定义组件。

完整的 shadcn `base-nova` 预设组件集已安装到 `packages/ui/src/components`，依赖由 `@cypheria/ui` 管理。通过 `@cypheria/ui/components/<name>` 导入组件。主要控件使用 `text-sm`（默认外观设置下为 14px），次要标签和应用层显式覆盖的字号仍可能更小。保留现有 Cypheria 兼容适配。若需补充后续发布的组件，运行 `pnpm --filter @cypheria/ui shadcn:add --all --yes`，对已定制文件选择不覆盖。有意使用 `--overwrite` 重新安装时，需要补回兼容适配并运行 UI/桌面测试。

完整的 AI Elements registry 源码位于 `packages/ui/src/components/ai-elements`，并通过 `@cypheria/ui/ai-elements/<name>` 导出。重新生成步骤以及 Base UI、NodeNext、严格 TypeScript、React 19 和 AI SDK 7 所需的兼容性修改，参见 [AI Elements 集成与升级指南](./ai-elements.zh-CN.md)。

Desktop renderer 使用 `@ai-sdk/react` 管理 chat state，并通过 `@cypheria/ai-sdk-provider` 支持的自定义 `ChatTransport` 通信。Renderer-owned LRU 对齐本机 ChatGPT Desktop renderer 的 `ThreadScope` `retain: { max: 20 }`，为最近且已结束的会话保留外部 `Chat` 与 transport；已挂载或运行中的会话会固定并可暂时超过上限。新会话 client key 与持久 Cypheria Thread ID 指向同一 scope。页面导航只让 view 脱离，不会 abort stream；稳定 transport 从可变 scope bindings 读取当前选项与回调。Transport 报告新建 Thread ID，让 renderer 用持久 route 替换 new-chat route。重新打开会话时读取 server-owned canonical timeline；同一共享 shell 渲染通用 message、reasoning、tool、command、diff、plan、approval、artifact、status 与 error item，provider extension 保留 agent 专有细节。Abort 取消 active server turn，按 capability 开启的 steer 使用 `thread.turn.steer`。较重的交互式 route shell 仍只在 client 加载，因为 Electron 通过 `cypheria://` 发布 SPA output，运行时不执行 TanStack Start server bundle。

Transport 根据 Thread 的 canonical `agentId` 选择 Codex、Claude、Pi、OpenCode 或 ACP；新会话可以选择任一已安装并启用的 server-managed Agent。排队 follow-up 由 retained Thread scope 而不是已挂载 workspace 持有，因此导航不会丢失。Browser-local attachment URL 在跨越 protocol boundary 前转成 embedded data，canonical user-message item 则保留 attachment block，以便 history restoration。

Composer prompt 文本遵循应用包中由 scope 持有的草稿模型，而不是 AI Elements 的挂载生命周期。
编辑会立即更新当前 client/durable thread aliases，并在 250 毫秒后持久化。Renderer 能在 route
切换与自身重启后恢复草稿，成功提交后删除草稿，并把持久条目限制为 100 个 aliases。这个 store
只保存字符串，既不会让额外的 `Chat`/transport 实例保持存活，也不会序列化 blob 附件 URL。
Session 附件与 `Chat` 存在同一个 retained scope 中，可跨 route 导航恢复，并在删除、提交或 scope
淘汰时释放 object URL。

异步用户问题是 reverse-request 路径的例外：App Server 将它持久化为带 `delivery: "async"` 与可选 `questions` 的 `agentMessage` item。Renderer 会把它投影成 turn 内问答面板，并使用 ChatGPT Desktop 的结构化 `send_user_message_question_reply` envelope 与稳定 question ID，通过 `turn/steer` 发送答案；用于 fallback 的 Markdown 不会被误判为 final answer。当前 turn 的文件进度来自该 turn 投影出的 `fileChange` items，而 Files panel 仍可在整个 thread 内按 path 聚合最新 artifact。

恢复历史时，只有结构化 async-question reply 引用了同一 turn 的 question ID，才会被识别为内部回复并从可见 user-message 列表中排除，其 turn snapshot 仍会保留。成功完成实时 stream 后还会用完整 UI-message 序列替换已有 thread-detail query entry，避免路由切换在后台刷新期间恢复到该 turn 之前的旧缓存。

会话滚动平面归 renderer 所有。AI Elements 提供已复制到本地的 `Conversation` 外壳，但 DOM ref 与即时回到底部操作由 Cypheria instance 管理；高度可变列表、row 测量、末端锚定与追加跟随由 TanStack Virtual 管理。有界内存 thread-state cache 会在工作区导航间恢复稳定可见 row 锚点与测量快照。Electron main 在 macOS 上通过关闭时隐藏主窗口、激活应用时展示同一窗口来保留该缓存；真正退出应用仍是销毁边界。

工作区布局偏好属于 Cypheria，而不是 Codex。Electron main 会校验这些设置，并原子写入 `$CYPHERIA_HOME/desktop/desktop-settings.json`；renderer 通过 typed IPC 读取是否显示标题栏底部面板控件，以及终端操作采用的默认底部/右侧位置。底部面板控件和 `Cmd/Ctrl+J` 与 `Control+反引号` 终端操作彼此独立。可折叠的 resizable panel handle 会把底部 dock 收到零；renderer 只把终端标签和 Xterm DOM 隐藏，仍保持挂载，并用 ref 记住上次的像素高度，在重新打开时通过 layout effect 恢复。关闭最后一个底部标签不会满足 view 的 `openWhenEmpty` gate，因此空 dock 会一直保留，直到“关闭”操作隐藏它；从隐藏状态明确重开时才创建 fallback 终端。可滚动 tablist 与固定的新增标签按钮是独立 flex 子项，因此标签溢出不会把面板操作一并滚走。底部面板状态和 PTY controller 由带 `key` 的会话之上的稳定工作区持有；会话导航重新挂载可见终端 subtree 后，每个标签最多一兆字节的 replay buffer 会重建 Xterm 输出。设置页 shell 使用与 ChatGPT Desktop 一致的固定 232 像素导航栏和居中的 48-rem 内容列；普通工作台侧栏则仍可独立调节宽度。Electron 不设置 `defaultFontSize` 和 `defaultMonospaceFontSize`，由 Chromium 提供与本机 desktop 相同的 16 像素 rem 基线；像素值 Tailwind typography token 则独立保持设置中的视觉 UI 和代码字号。因此设置页、会话和 composer 的共享宽度直接与源码一致为 768 像素，不再让文字大小偏好连带缩放布局几何。
Xterm FitAddon 的输出会先限制到 terminal IPC 的尺寸边界，并对相同尺寸去重后才发送 resize，以覆盖终端移入较高右侧面板时出现的瞬时超大测量值。工作区与 Connections 终端的背景、前景、光标、选区、代码字体和代码字号均来自实时 Tailwind/shadcn 外观 token，而不是嵌入另一套深色调色板；其原生 Xterm viewport 使用本机 ChatGPT Desktop 应用包 `terminal-panel` 样式表中的同款 10 像素 token 化轨道/滑块处理，并会在应用主题变化时刷新。

| Category | Choice |
| --- | --- |
| Component model | shadcn-style copied components |
| Primitive layer | Base UI for overlays and interactive primitives |
| Styling | Cypheria CSS tokens and class variants |
| Icons | lucide-react |
| Motion | motion |
| Command menu | cmdk/shadcn command patterns |
| Code editor | Monaco Editor |
| Terminal | xterm.js |

主题处理遵循 Tailwind v4 和 shadcn 的 CSS variable 模型。Codex-compatible
appearance config、shadcn token mapping、theme preset 行为和 font-size 规则见
`docs/theme.zh-CN.md`。

Cypheria-specific components：

- Wallet switcher。
- Signature approval。
- Transaction simulation panel。
- dApp permission inspector。
- Chain/RPC selector。
- Policy rule builder。
- Web3 browser address bar。
- Codex thread event adapter。

视觉方向：安静、工作导向、低饱和、面板化，信息密度足够支撑真实工程工作流，并接近 Codex Desktop。避免 Web3 霓虹营销风格。

桌面侧栏动画与悬停预览由 `apps/desktop/renderer/src/components/desktop-sidebar.tsx` 及其 CSS 实现，复用共享 UI 侧栏基础组件。固定侧栏收起时同步改变布局占位宽度并将面板滑出；悬停预览覆盖内容，不占布局宽度。对话标题栏的左侧预留空间与收起后的工具栏同步变化。原生窗口控制按钮保持固定，并在用户偏好减少动态效果时禁用过渡。 窗口工具栏使用固定像素尺寸：标题栏 44px、点击区域 28px、图标 15px、间距 6px；这些尺寸不随 UI 字体设置缩放，工具栏中心与 macOS 原生红黄绿按钮的 y=22px 中心对齐。 侧栏工具栏图标保持固定，由收起中的面板裁切，并露出下方收起工具栏，不交叉淡化。标题栏底部分隔线位于侧栏下方，侧栏工具栏底部不显示分隔线。点击收起后，只有光标移出切换按钮再进入才触发预览。对齐 ChatGPT Desktop 的 `--spacing-token-sidebar`，拖拽右边线可在 240–520px 范围内调宽，同时为工作台至少保留 320px；双击恢复 275px，聚焦边线后支持方向键与 Home/End。拖到 240px 最小宽度后继续向左超过 120px（最小宽度的一半）会收起侧栏并关闭预览；再次展开时保留最小宽度。宽度在当前应用会话的页面切换间保留。

工作区中位于 New chat 与 Search 下方的导航会被展平为带稳定 key 的行，并由单个 `@tanstack/react-virtual` virtualizer 渲染；Section 与 Project 展开只重建可见行模型。Pinned、自定义 Section、Project 与 Recents 页面统一通过 Sidebar data adapter 调用 Cypheria Projects/Threads/Sections API。Server 直接返回 Section membership、Project nesting 与 ordering，renderer 不再从 provider metadata 推断组织关系。非敏感的展示与排序偏好仍保留在 renderer-local storage。Show more 控制 Pinned、Projects 与 Project chat 每次展示五项，只有 Recents 末尾加载行会自动请求下一个 cursor 页面。

条目菜单复用共享的 shadcn 风格 dropdown、submenu、dialog、input 与 button 基础组件。活跃 Thread 条目保留可逆菜单模型：置顶、重命名、标记已读/未读、移动、复制、Fork 与归档；永久删除仍位于“已归档会话”。Thread 归档/Fork/移动与 Project/Section 变更通过 `@cypheria/client` 执行，并带乐观 cache update 与回滚。手动已读状态继续由 renderer 持有，采用有界列表并在同源窗口间同步，同时从 canonical Thread notification 更新。Project folder reveal 仍是 Electron-only capability：renderer 只传 Project ID，由 main 解析可信 root 后调用操作系统 shell。

## Web3 Stack

| 分类 | 选型 |
| --- | --- |
| EVM client | viem |
| React wallet hooks | wagmi only for lightweight UI state if needed |
| Vault wallets | viem/accounts + encrypted vault |
| Embedded wallets | Privy |
| External wallets | WalletConnect / Reown |
| Chain registry | 兼容 viem chain format 的自维护 registry |
| RPC routing | 按用途选择的有序 endpoints；仅对幂等读取进行基于 health 的 failover |
| RPC credentials | SQLite 只保存引用，连接记录由 OS-backed 机制保护 |
| Asset providers | Alchemy / Reservoir / SimpleHash / Moralis 的 adapter boundary |
| Transaction simulation | Tenderly / Blocknative first; self-hosted simulation later |

`@cypheria/web3` 是唯一的 Web3 领域包，并提供四个可独立导入的子路径：

- `@cypheria/web3/network`：canonical chain identity、严格 network/RPC schema、catalog record 与 protocol conversion helper。
- `@cypheria/web3/wallet`：wallet/account/chain/signing intent models。
- `@cypheria/web3/provider`：origin-scoped dApp sessions、Ethereum EIP-1193/EIP-6963 injection 与 discovery、有界 Ethereum JSON-RPC 和 permissions、Solana Wallet Standard discovery 与 byte envelopes、protocol-scoped events，以及 persistence contracts。
- `@cypheria/web3/policy`：signing policy schemas 和 deterministic evaluation。

私钥永远不进入 renderer、dApp pages、localStorage、IndexedDB 或普通 SQLite tables。

Network configuration、endpoint selection、credential protection、dApp-scoped chain selection 与 failure behavior 详见 `docs/network-management.zh-CN.md`。

## Policy And Schedule Stack

| 分类 | 选型 |
| --- | --- |
| Policy schema | Zod-validated JSON policy |
| Policy evaluator | Deterministic TypeScript evaluator |
| Scheduler | Server `ScheduleService`，支持 once、interval 与五字段 cron cadence |
| Runner | Server-owned Thread/Web3 target executor |
| Logs | Structured logs persisted through runtime/db |

Policy modes：

- Read-only。
- Human approval。
- Conditional auto-signing。

Signing policy 保存在显式的 `signing_policies` libSQL 表中。the `apps/server` runtime 提供严格的 create、get、list、update、disable 和 evaluate 操作。记录包含 timestamp 与单调递增 revision；update 和 disable 使用 compare-and-swap 语义，避免并发编辑静默覆盖。

评估时先应用 wallet mode，再匹配已启用且未过期的钱包 policy。显式 deny 优先于 human approval，human approval 优先于 allow；policy ID 作为确定性 tie breaker。未匹配的 conditional auto-signing 请求必须进入 human approval。每次变更和评估结果都有稳定的 decision 或 policy 标识以及脱敏 audit record。

Signing intents 与 approval requests 保存在显式的 libSQL tables 中。系统保留精确 canonical intent payload，以确保审批内容与最终签名的字节完全一致；audit log 只保留其 SHA-256 hash 和脱敏摘要。审批决议使用基于 revision 的 compare-and-swap 与原子 libSQL batch，防止两个 reviewer 对同一请求作出不同决议。待审批尝试会先授权、后执行一次性 replay claim，因此批准后可以重试；已批准尝试则在访问秘密并签名前立即 claim。

Schedules 由 Server 负责。`apps/server` 通过 `@cypheria/protocol` 与 `@cypheria/client` 暴露版本化的 create、list、get、update、pause、resume、delete、manual-run 和 run-history 操作。Schedule 可以启动新的 Agent thread、继续已有 thread，或请求受 policy 控制的 Web3 操作。SQLite 保存 cadence、next-run state、lease、result 与 error；启动恢复只标记被中断的工作，不会重放进行中的 Web3 签名或广播。Desktop 不再拥有 Schedule IPC 或本地 scheduler，与 CLI 和未来客户端一样只调用 Schedule API。

## Data Stack

| 分类 | 选型 |
| --- | --- |
| Database | SQLite |
| ORM | Drizzle ORM |
| Driver | libSQL 本地 SQLite 入口（`@libsql/client/sqlite3`） |
| Migrations | Drizzle Kit code-first `generate` + `migrate` |
| Search | SQLite FTS5 when needed |
| Sensitive data | encrypted vault，不进普通 SQLite tables |

数据库字段约定和单一来源迁移流程见 [`docs/database.zh-CN.md`](./database.zh-CN.md)。

当前核心 tables：

```txt
settings
audit_logs
workspaces
runtime_metadata
schedules
schedule_runs
wallets
wallet_accounts
chain_accounts
wallet_hd_schemes
active_wallet_context
signing_policies
signing_intent_claims
signing_intents
approval_requests
dapp_origins
dapp_permissions
```

规划 tables：

```txt
rpc_endpoints
```

## 工程规则

- 使用 pnpm，不使用 npm/yarn/bun，除非用户明确要求。
- pnpm 相关命令通常应在沙盒外执行，以便 pnpm 使用全局存储。
- 保持 TypeScript strict。
- 在 runtime boundaries 使用 Zod：IPC、policy schemas、wallet inputs、schedule definitions 和 generated-protocol adapters。
- 保持 package boundaries 明确。
- 保持 domain/data packages 不依赖 the `apps/server` runtime；runtime 通过显式 service injection 组合它们，而不是让它们反向 import runtime。
- 架构、行为、命令、package boundary 或 runtime path 变化时，英文和中文文档同步更新。

## V1 暂不采用

- 不做 TUI。
- 不 fork Codex runtime。
- 不创建 `@cypheria/codex-protocol` package。
- 不手写 Codex app-server protocol types。
- 不做 cloud agent execution。
- 在 local runner 被验证前，不引入复杂 workflow engine。
- 不将私钥放入 renderer、localStorage、IndexedDB 或普通 SQLite tables。
- 不在 dApp origins 之间共享 browser sessions。
- 不把 wagmi 作为核心钱包层。
