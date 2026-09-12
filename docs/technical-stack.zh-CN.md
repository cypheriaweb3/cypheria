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
| Server build 与 daemon | tsdown、supervisor/worker、PID lock、heartbeat、有界 restart |
| Client protocol | `@cypheria/protocol`、Zod、HTTP + WebSocket `cypheria.v1` |
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
| Desktop Codex integration | `codex app-server` over WebSocket JSON-RPC |
| Codex protocol types 与 validation | `pnpm --filter @cypheria/protocol generate:codex-all` |
| ACP bridge | `@agentclientprotocol/sdk@1.4.0` app API，通过 `@ai-sdk/provider` 4.x 的 `LanguageModelV4` 接口接入 AI SDK 7.x |
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
  Hono control plane、runtime host、静态 web host 与 supervised daemon。

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
packages/runtime
packages/codex-bridge
packages/acp-ai-provider
packages/ui
packages/network-core
packages/wallet-core
packages/wallet-provider
packages/policy-engine
packages/automation-core
packages/db
```

`apps/cli`、`apps/marketplace` 和 `packages/sdk` 是规划中的 packages。`apps/server`、`apps/expo`、`packages/client` 与 `packages/protocol` 已实现 client/server 基础。Desktop 在该基础通过评审前保持不变。

`@cypheria/protocol` 使用 Zod author live WebSocket contract，并持有 generated Codex App Server TypeScript、JSON Schema、response mapping 与 validator。完整 `agent.codex.*` RPC 与 notification catalog 从这些已提交产物机械派生；provider payload 在共享 wire 上保持 JSON-transparent。Cypheria 自有 envelope 显式使用 strict object，provider-owned extension surface 显式使用 loose object，大型消息族按 `type` 或 `protocolVersion` discriminator 分派，而不是线性尝试 union。对象 schema 使用 `.extend()` 或 shape spread 组合；只有上游 JSON Schema 将 variant union 与公共约束组合时，才保留生成的 intersection。它还导出有方向的 `agent.acp.*` envelope，直接采用官方 SDK 的稳定 v1、显式 draft-v2 types 与 generated Zod validator，包括 method/direction check 和 variadic-tuple v2 batch 语义。一个最小且固定版本的 pnpm patch 会暴露 SDK 已发布但私有的 v1/v2 Zod module，无需复制。Codex catalog 发生漂移时，build、typecheck 与 test lifecycle check 会失败。

`@cypheria/client` 依赖 `@cypheria/protocol`、只处理传输的 `@cypheria/relay`，以及 protocol 所用的同一精确版本 `@agentclientprotocol/sdk`。它的 `ServerClient` 实现可注入 transport boundary、browser 与 Node WebSocket adapter、hello/authentication、请求关联、超时、protocol validation、typed error、事件分发与有界指数退避重连。`CypheriaApi` 是不带 lifecycle 的借用门面；`CypheriaClient` 持有一条连接。该门面只暴露当前 protocol message family：server operation、通用 runtime request/event、typed Codex traffic 与 ACP envelope；它不会从 runtime method 字符串推断产品 action。`@cypheria/client/codex` 实现 Cypheria 自有的 SDK-shaped `client()` 与 `ClientApp` API：typed async `ClientContext.request()` 持有每次 request/response exchange，fluent handler 接收 notification 与反向 request，并写回 typed reverse response。该 app 连接最小的 `agent.codex` endpoint，不使用 generated action tree。稳定的 `@cypheria/client/acp` 与显式的 `@cypheria/client/acp/v2` 入口采用相同 app 形态，选择性重新导出支持的 upstream helper 与 type，并省略已废弃 connection API。其私有的有方向 Web Streams bridge 把 SDK JSON-RPC traffic 包装进 protocol-owned v1/v2 envelope，保留 v2 batch，在所有借用门面之间共享一个活跃 ACP ID space，并在 Cypheria transport 断开时终止 pending ACP work。Codex app 同样在每个 endpoint 上只允许一个活跃 consumer，并在 transport loss 时关闭。

`@cypheria/client` 还接受与直连配置互斥的 `relayOffer`。它通过 `@cypheria/relay` 在现有
Cypheria session 握手之前完成 E2EE。`apps/relay` 使用 Go 1.25；`--mode=single` 在单进程内
组合 gateway、worker 与 memory coordinator，不需要 etcd，但必须严格只有一个副本。
`--mode=cluster` 拆分 gateway 与 worker role，并增加 etcd v3 lease、rendezvous ownership 和
内部 TLS 1.3 双向认证。仓库提供 TOML 配置和 Kustomize base，etcd 与 Collector 仍由外部提供。
两个模式都使用 `coder/websocket`、显式加权入口内存预算和容器感知 Go 内存上限。
进程只通过 OTLP/gRPC 导出 metrics 和短生命周期 routing span，不提供 Prometheus endpoint。
详见 [Cypheria Relay](relay.zh-CN.md)。

## Server 与 Expo 技术栈

`apps/server` 使用 Hono 而不是 Express。Hono 负责 JSON route、validation middleware、严格 API fallthrough、static file 与 WebSocket upgrade route。Node adapter 让一个 HTTP listener 与 `ws` no-server instance 共用端口。Transport-neutral session state machine 要求版本化 hello、关联 request、限制 frame、广播 runtime event，并暴露 server information、diagnostics、runtime forwarding 与 lifecycle request。

Daemon 分为 supervisor 与 worker process。Supervisor 持有 PID record、heartbeat watchdog、crash budget、restart backoff 与 signal；worker 持有 `CypheriaRuntime` 和 network listener。两者都向 `$CYPHERIA_HOME` 下追加结构化 Pino log。详见 [Cypheria Server](server.zh-CN.md)。

`apps/expo` 对 web 使用 Expo Router static output，并由同一套 route/component 构建 iOS 与 Android。Expo 的 monorepo-aware Metro setup 无需手工配置 watch folder 即可解析 workspace package。Server build 依赖 Expo build，并把完整 `dist` tree 复制到 `apps/server/dist/web`；Hono 使用 SPA fallback 提供这些文件。

## Marketplace 技术栈

`apps/marketplace` 是部署到 Cloudflare Workers 的 SSR-first TanStack Start 应用，复用 `@cypheria/ui`、TanStack Router/Query/Form、Zod、Drizzle 与 Lingui。自定义 Worker entrypoint 将 HTTP request 委托给 TanStack Start，并提供 public、publisher、reviewer 和版本化 Desktop API 界面。

D1 是 identity、GitHub source、draft、scan、review、release、publication、advisory 和 audit event 的 source of truth。R2 保存默认私有的不可变 evidence 与 public asset。Queues 分发有界 job；Workflows 编排 source scanning、人工 review 和 publication。最小权限 GitHub App 将 active release 确定性同步到 Cypheria 官方 repository 的 `.agents/plugins/marketplace.json`。只接收由 commit SHA 固定的 public open-source GitHub `url` 与 `git-subdir` source。Desktop 使用 Marketplace API 发现，并通过 App Server Git marketplace operation 安装。详见 [Cypheria Marketplace 设计](marketplace.zh-CN.md)。

## Runtime Stack

`@cypheria/runtime` 是 Cypheria 自有非 agent services 的 TypeScript host。它应该组合 domain packages，而不是重复定义它们的模型。

Runtime 职责：

- 解析 `$CYPHERIA_HOME`，默认 `~/.cypheria`。
- 派生 `CODEX_HOME=$CYPHERIA_HOME/codex`。
- 初始化 runtime directories。
- 连接 database、audit、wallet、policy、browser、automation 和 settings services。
- 向 `apps/server` 暴露 typed request/event API。

Runtime 不实现 Codex agent internals。

## CLI Stack

`apps/cli` 是规划中的无 TUI Node CLI。它依赖共享 Cypheria protocol，并连接 `apps/server`。

它不得依赖：

- `@cypheria/sdk`
- `@cypheria/runtime`
- `@cypheria/codex-bridge`
- Electron 或 desktop packages

初始命令行为：

- `cypheria run <prompt>` 请求 server 执行 agent workflow。
- `cypheria run --jsonl <prompt>` 输出机器可读的 event/result。
- `cypheria runtime info` 读取 Cypheria runtime metadata。
- Web3 命令使用版本化 server operations。

## SDK Stack

`@cypheria/sdk` 是规划中的公共 TypeScript server client，面向 Node 与兼容的 JavaScript 应用。它依赖 `@cypheria/protocol` 与 transport implementation。

它不得依赖：

- `apps/cli`
- `@cypheria/runtime`
- Electron 或 desktop packages
- `@cypheria/codex-bridge`

SDK clients 应该是版本化 server operation 与 event stream 之上的轻量 wrapper。

## ACP AI Provider Stack

`@cypheria/acp-ai-provider` 是 Node 侧 ACP bridge。其稳定入口使用精确固定的 `@agentclientprotocol/sdk@1.4.0` 所提供的 ACP v1，并通过 `@ai-sdk/provider` 4.x 提供的 `LanguageModelV4` 接口实现 AI SDK 7。它支持 stdio、可注入 stream、实验性 SDK HTTP/WebSocket transport、由能力派生的 client callback、彼此独立的 model/session lifecycle、typed session configuration、经过协商的 NES 控制、原生 resource link、控制与事件访问、无损 raw ACP update，以及默认安全取消的权限请求。宿主工具通过带认证的 loopback proxy 使用 `@modelcontextprotocol/sdk` 1.x 语义，并协商至 `2025-11-25` 的 handshake 版本。独立的 `experimental/v2` export 在显式 opt-in 后暴露官方 draft-v2 client context；它不是 `LanguageModelV4` adapter。

## Desktop Stack

在 server 评审期间，Desktop 保留当前 Electron + TanStack Start 实现。后续变更会让它成为可自启动 Cypheria server 的 client。

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

Renderer code 只使用 typed IPC。Electron main 拥有 privileged services 和 Codex App Server lifecycle。

语言选择器位于常规设置页。

Desktop 提供 Codex 风格的可搜索语言选择器。显式选择会作为 `[desktop]` section 下的 `localeOverride` 持久化到 `$CYPHERIA_HOME/codex/config.toml`；自动检测以该键不存在来表示。Electron 根据 preferred-language list 解析自动检测，通过 preload bootstrap 传入偏好与最终 catalog locale，并通过 typed IPC 广播后续变更。由于打包后的 SPA shell 在构建时预渲染，服务端输出与首次客户端渲染统一使用英语 source catalog；hydration 完成后，renderer 立即激活 bootstrap catalog，同步 document 的 `lang` 与 `dir` 属性，并在不重载页面的情况下切换语言，从而避免 locale 导致的 hydration mismatch。英语与简体中文随包提供 catalog；其他选择当前保留原始 `localeOverride`，但界面回退英语。PO 文件提交到仓库；`pnpm --filter @cypheria/desktop i18n:extract` 用于更新 catalog，`i18n:compile` 用于严格校验翻译完整性。

设置导航分为“个人”“集成”“编码”和“已归档”，并按本地化后的目标名称筛选；`Cmd/Ctrl+F` 可以在任意设置路由聚焦搜索。已归档聊天路由通过 `archived: true` 分页调用 `thread/list`，把查询作为 `searchTerm` 交给 App Server，并经由 main/preload 边界暴露 typed `thread/unarchive` 与需要确认的 `thread/delete` 操作。缺少 Codex App Server 或 Cypheria 自有后端的 ChatGPT 服务设置保持在范围之外，不显示成无法工作的空壳控件。

Desktop main bundle 将 `@libsql/client` 及其 platform packages 保持为 external，使 Electron 在运行时加载匹配的 native binary。`build:main` 会把已提交的 Drizzle migrations 复制到 `dist/drizzle`，因此 packaged startup 与 tests、development 使用同一 migration source。应用 ready 之前，Electron user/session data 会以 `$CYPHERIA_HOME/browser` 为根目录。

## Codex 集成

目标架构由 server 为每个 client 持有 Codex。以下 direct path 描述临时保留且未修改的 desktop 实现：

```txt
Desktop
  -> @cypheria/codex-bridge
  -> codex app-server over WebSocket JSON-RPC
```

`@cypheria/codex-bridge` 只负责 desktop 集成。它应该：

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

Desktop renderer 使用 `@ai-sdk/react` 管理 chat state，并通过基于 typed Electron IPC 的自定义 `ChatTransport` 通信。Renderer-owned LRU 对齐本机 ChatGPT Desktop renderer 的 `ThreadScope` `retain: { max: 20 }`，为每个最近且已结束的会话保留一个外部 `Chat` 与 transport；已挂载或运行中的会话会被固定并可暂时超过该上限。新会话的 client key 与持久 App Server thread ID 指向同一 scope。页面导航只让 view 脱离，不会 abort stream；稳定 transport 从可变 scope bindings 中读取当前选项与回调。Electron main 使用 `@cypheria/codex-bridge` 的 `ProviderV4` adapter，将 App Server 输出转换为 AI SDK UI-message chunks。Transport 会报告新建的 thread ID，让 renderer 用持久对话 route 替换 new-chat route。实时 turn 会保留 turn status/timing、完整 item snapshot/order、agent-message phase、progress、plan、diff、reroute 与 raw turn-scoped event。重新打开对话时会读取 metadata 与设置了 `itemsView: "full"`、按升序分页的 `thread/turns/list`，并让这些持久 turn/item snapshot 经过同一个 `CodexTurnProjector`；除非 App Server 把 notification-only state 写入 stored turn，否则它必然只能在实时流中存在。显式取消会在刷新 App Server 状态的同时，把 live item 生命周期乐观完成，并在 AI SDK state 与 thread query cache 中将 turn 标记为 interrupted，避免点击 Stop 后残留运行中卡片。Renderer 将 final answer 与分组后的 activity 分开，完成后自动折叠工作记录，并在匹配的 reverse request 待处理时保持 activity 展开。标准 AI SDK parts 继续用于通用渲染，并驱动工作区的 Files、Review 和 Terminal 面板，让最新 diff、ANSI output、streaming state 与 completion metadata 在实时和已恢复对话中保持一致。App Server reverse request 使用独立的 typed interaction IPC channel，因此 approval 与 elicitation 不会编码为 model message；Electron main 会保留尚未解决的 interaction event，并暴露 typed list operation，使重新挂载的 chat 可以恢复待处理卡片。较重的交互式 route shells 仅在客户端加载，因为 Electron 通过 `cypheria://` 发布 SPA output，运行时不会执行 TanStack Start server bundle。

Composer prompt 文本遵循应用包中由 scope 持有的草稿模型，而不是 AI Elements 的挂载生命周期。
编辑会立即更新当前 client/durable thread aliases，并在 250 毫秒后持久化。Renderer 能在 route
切换与自身重启后恢复草稿，成功提交后删除草稿，并把持久条目限制为 100 个 aliases。这个 store
只保存字符串，既不会让额外的 `Chat`/transport 实例保持存活，也不会序列化 blob 附件 URL。
Session 附件与 `Chat` 存在同一个 retained scope 中，可跨 route 导航恢复，并在删除、提交或 scope
淘汰时释放 object URL。

异步用户问题是 reverse-request 路径的例外：App Server 将它持久化为带 `delivery: "async"` 与可选 `questions` 的 `agentMessage` item。Renderer 会把它投影成 turn 内问答面板，并使用 ChatGPT Desktop 的结构化 `send_user_message_question_reply` envelope 与稳定 question ID，通过 `turn/steer` 发送答案；用于 fallback 的 Markdown 不会被误判为 final answer。当前 turn 的文件进度来自该 turn 投影出的 `fileChange` items，而 Files panel 仍可在整个 thread 内按 path 聚合最新 artifact。

恢复历史时，只有结构化 async-question reply 引用了同一 turn 的 question ID，才会被识别为内部回复并从可见 user-message 列表中排除，其 turn snapshot 仍会保留。成功完成实时 stream 后还会用完整 UI-message 序列替换已有 thread-detail query entry，避免路由切换在后台刷新期间恢复到该 turn 之前的旧缓存。

会话滚动平面归 renderer 所有。AI Elements 提供已复制到本地的 `Conversation` 外壳，但 DOM ref 与即时回到底部操作由 Cypheria instance 管理；高度可变列表、row 测量、末端锚定与追加跟随由 TanStack Virtual 管理。有界内存 thread-state cache 会在工作区导航间恢复稳定可见 row 锚点与测量快照。Electron main 在 macOS 上通过关闭时隐藏主窗口、激活应用时展示同一窗口来保留该缓存；真正退出应用仍是销毁边界。

工作区布局偏好属于 Cypheria，而不是 Codex。Electron main 会校验这些设置，并原子写入 `$CYPHERIA_HOME/config/workspace-layout.json`；renderer 通过 typed IPC 读取是否显示标题栏底部面板控件，以及终端操作采用的默认底部/右侧位置。底部面板控件和 `Cmd/Ctrl+J` 与 `Control+反引号` 终端操作彼此独立。可折叠的 resizable panel handle 会把底部 dock 收到零；renderer 只把终端标签和 Xterm DOM 隐藏，仍保持挂载，并用 ref 记住上次的像素高度，在重新打开时通过 layout effect 恢复。关闭最后一个底部标签不会满足 view 的 `openWhenEmpty` gate，因此空 dock 会一直保留，直到“关闭”操作隐藏它；从隐藏状态明确重开时才创建 fallback 终端。可滚动 tablist 与固定的新增标签按钮是独立 flex 子项，因此标签溢出不会把面板操作一并滚走。底部面板状态和 PTY controller 由带 `key` 的会话之上的稳定工作区持有；会话导航重新挂载可见终端 subtree 后，每个标签最多一兆字节的 replay buffer 会重建 Xterm 输出。设置页 shell 使用与 ChatGPT Desktop 一致的固定 232 像素导航栏和居中的 48-rem 内容列；普通工作台侧栏则仍可独立调节宽度。Electron 不设置 `defaultFontSize` 和 `defaultMonospaceFontSize`，由 Chromium 提供与本机 desktop 相同的 16 像素 rem 基线；像素值 Tailwind typography token 则独立保持设置中的视觉 UI 和代码字号。因此设置页、会话和 composer 的共享宽度直接与源码一致为 768 像素，不再让文字大小偏好连带缩放布局几何。
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

工作区中位于 New chat 与 Search 下方的导航会被展平为带稳定 key 的行，并由单个 `@tanstack/react-virtual` virtualizer 渲染；分区和项目展开只重建可见行模型。Pinned 分页通过 App Server 内置 pinned section 过滤；未分区的 thread 页面提供 Projects 与 Recents，自定义分区则通过 renderer-safe IPC 暴露的 generated experimental `threadSection/*` 与 `thread/section/move` 调用进行列举和变更。非敏感的组织及排序偏好保存在 renderer storage 中。Show more 控制 Pinned、Projects 与项目会话每次展示五项，只有 Recents 末尾的加载行会自动请求下一个 cursor 页面。

条目菜单复用共享的 shadcn 风格 dropdown、submenu、dialog、input 与 button 基础组件。活跃会话条目对齐 ChatGPT Desktop 的可逆菜单模型：置顶、重命名、标记已读/未读、移动、复制、Fork 和归档；永久删除保留在“已归档会话”中。Thread 归档/Fork/项目移动和 project 更新/删除始终位于收窄的 typed IPC 后方。由于 App Server 的 thread metadata 没有未读字段，手动已读状态由 renderer 所有：用去重且最多 1,000 个 thread ID 的列表跨 renderer/窗口重建持久化，在同源窗口间同步，在 thread 归档或删除时清除，并由后台会话的 `turn/completed` notification 更新；打开会话会标记为已读。项目置顶和自定义分区归属使用 `cypheria.sidebar.*` metadata key。Renderer 请求在访达中显示项目时只传 App Server project ID，Electron main 解析第一个注册 root 后再调用操作系统 shell。批量归档会先遍历 App Server cursor，再逐个变更匹配 thread，因而会覆盖折叠或尚未渲染的行。侧栏排序暴露 App Server 的 priority/recency、更新时间、创建时间与手动 section-position 排序。

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

核心 packages：

- `@cypheria/network-core`：canonical chain identity、严格 network/RPC schema、catalog record 与 protocol conversion helper。
- `@cypheria/wallet-core`：wallet/account/chain/signing intent models。
- `@cypheria/wallet-provider`：origin-scoped dApp sessions、Ethereum EIP-1193/EIP-6963 injection 与 discovery、有界 Ethereum JSON-RPC 和 permissions、Solana Wallet Standard discovery 与 byte envelopes、protocol-scoped events，以及 persistence contracts。
- `@cypheria/policy-engine`：signing policy schemas 和 deterministic evaluation。

私钥永远不进入 renderer、dApp pages、localStorage、IndexedDB 或普通 SQLite tables。

Network configuration、endpoint selection、credential protection、dApp-scoped chain selection 与 failure behavior 详见 `docs/network-management.zh-CN.md`。

## Policy And Automation Stack

| 分类 | 选型 |
| --- | --- |
| Policy schema | Zod-validated JSON policy |
| Policy evaluator | Deterministic TypeScript evaluator |
| Scheduler | cron-parser or equivalent local scheduler |
| Runner | worker_threads or child_process |
| Logs | Structured logs persisted through runtime/db |

Policy modes：

- Read-only。
- Human approval。
- Conditional auto-signing。

Signing policy 保存在显式的 `signing_policies` libSQL 表中。`@cypheria/runtime` 提供严格的 create、get、list、update、disable 和 evaluate 操作。记录包含 timestamp 与单调递增 revision；update 和 disable 使用 compare-and-swap 语义，避免并发编辑静默覆盖。

评估时先应用 wallet mode，再匹配已启用且未过期的钱包 policy。显式 deny 优先于 human approval，human approval 优先于 allow；policy ID 作为确定性 tie breaker。未匹配的 conditional auto-signing 请求必须进入 human approval。每次变更和评估结果都有稳定的 decision 或 policy 标识以及脱敏 audit record。

Signing intents 与 approval requests 保存在显式的 libSQL tables 中。系统保留精确 canonical intent payload，以确保审批内容与最终签名的字节完全一致；audit log 只保留其 SHA-256 hash 和脱敏摘要。审批决议使用基于 revision 的 compare-and-swap 与原子 libSQL batch，防止两个 reviewer 对同一请求作出不同决议。待审批尝试会先授权、后执行一次性 replay claim，因此批准后可以重试；已批准尝试则在访问秘密并签名前立即 claim。

Automation 是 local-first。Tasks 可以使用 Codex SDK、读取链上状态、创建 signing intents，并写入 audit logs。Tasks 不得绕过 policy engine。

`@cypheria/runtime` 拥有 automation service，并暴露 `automation.task.create`、`automation.task.list`、`automation.task.get`、`automation.task.pause`、`automation.task.resume`、`automation.run.start`、`automation.run.get` 与 `automation.run.list`。`@cypheria/automation-core` 负责严格 task/run schema 和状态流转，`@cypheria/db` 负责异步 SQLite 持久化与乐观更新。Executor 按 handler name 注入，且只能获得受 scope 限制的 agent 与 signing-intent capabilities。目标架构由 server 组合 agent capability，只向 client 暴露有界 operation；desktop 在迁移前保留现有 path。

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
automation_tasks
automation_runs
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
- 在 runtime boundaries 使用 Zod：IPC、policy schemas、wallet inputs、automation definitions 和 generated-protocol adapters。
- 保持 package boundaries 明确。
- 保持 domain/data packages 不依赖 `@cypheria/runtime`；runtime 通过显式 service injection 组合它们，而不是让它们反向 import runtime。
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
