# Cypheria 开发 Todo

这个 todo 用于追踪可审查粒度的实现工作。每一项都应该有意义、可测试，并适合独立提交。

状态说明：

- `[ ]` 未开始
- `[~]` 进行中
- `[x]` 已完成

## 已完成的基础能力

- [x] 重新安装全部 AI Elements 组件并适配 Nova 共享基础组件。
  - 验收：重新生成全部 48 个 registry 组件，保留兼容与安全适配；Tooltip/上下文触发器不嵌套交互元素；状态样式匹配 Base UI 属性。
  - 验证：`pnpm run ci`、`pnpm build`、UI/桌面测试及 Nova 交互回归测试。

- [x] 将共享 shadcn 组件集切换为 `base-nova`。
  - 验收：UI 与桌面 registry 配置使用 Nova；重新安装全部 registry 组件并保留兼容适配；主要控件使用标准 UI 字号，不调整应用层字号覆盖。
  - 验证：`pnpm run ci`、桌面 build、UI 与桌面测试。

- [x] 初始化 Turborepo + pnpm monorepo。
  - 验收：根 scripts、workspace packages、TypeScript base config、Biome、Turbo pipeline 和 lockfile 已存在。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加项目 README、架构文档、技术选型、todo 文档和 agent 指令。
  - 验收：英文主文档和 `.zh-CN.md` 中文伴随文档已存在。
  - 验证：`pnpm run ci`。

- [x] 添加 runtime home 解析。
  - 验收：`@cypheria/runtime` 可解析 `$CYPHERIA_HOME`，默认值为 `~/.cypheria`，并派生 `CODEX_HOME=$CYPHERIA_HOME/codex`。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 runtime directory 初始化。
  - 验收：runtime package 可以显式创建所有 Cypheria-owned runtime directories。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 Electron main runtime bootstrap helper。
  - 验收：desktop main package 在创建窗口前初始化 runtime directories。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 Electron + TanStack Start desktop shell。
  - 验收：desktop 有可运行的 Electron main process、preload bridge baseline 和带 sidebar navigation 的 TanStack Start renderer shell。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 建立 Cypheria 品牌资产体系。
  - 验收：SVG 保持为可编辑的 source of truth；Electron 窗口/Dock 图标、浏览器 favicon 与跨平台打包衍生文件统一使用 approved mark，并有成文的使用规则。
  - 验证：`pnpm --filter @cypheria/desktop brand:generate`、desktop checks/build，以及 favicon 与应用图标尺寸的视觉检查。

- [x] 添加 typed IPC contract 和 router baseline。
  - 验收：desktop-local IPC contracts 定义初始 app/runtime contracts，desktop main 会验证 handler inputs/outputs。
  - 验证：`pnpm run ci`、`pnpm build`。

- [x] 添加 database、audit、wallet、policy、Web3 browser、automation、Codex bridge 和 UI baselines。
  - 验收：domain packages 包含 V1 边界所需的初始 types/services/tests。
  - 验证：`pnpm run ci`、`pnpm build`，以及已有 package-level tests。

## 架构对齐

- [x] 添加 Cypheria client/server 基础，不迁移 desktop。
  - 验收：`apps/server` 提供 Hono HTTP/WebSocket control plane、版本化 client session、runtime lifecycle、运维 endpoint、supervised daemon lifecycle 与内置 Expo web hosting；`apps/expo` 面向 iOS、Android 与静态 web；`@cypheria/protocol` 提供共享 validated contracts。
  - 排除：agent、project、wallet、policy、browser 与 automation 产品 method；任何 `apps/desktop` code change。
  - 验证：protocol/server/Expo tests 与 typechecks、Expo compatibility check 与 static export、server build 与 embedded-web smoke test、daemon start/status/restart/stop smoke test、全仓库 CI/build。

- [ ] 在明确评审后将 desktop 迁移到 Cypheria server。
  - 验收：Electron main 确保本地 supervised server 正在运行，desktop 使用共享 protocol，并保持 Electron-only dApp/browser、secure-storage、approval、preload 与 OS-integration 边界。
  - 前置条件：明确批准 server 基础；不得作为 foundation change 的一部分开始。

- [x] 按 server 与 multi-client 目标架构重写文档。
  - 验收：README、architecture、technical stack、todo docs 和 `AGENTS.md` 只描述当前目标架构。
  - 包括：不创建 `@cypheria/codex-protocol`、client 共用 `@cypheria/protocol`、目标架构由 server 持有 runtime、desktop migration 显式分阶段，并且 generated Codex app-server TS 仍位于 `@cypheria/codex-bridge` 内部。
  - 验证：`pnpm run ci`、`pnpm build`。

## Runtime

- [x] 将 `@cypheria/runtime` 扩展为 Cypheria runtime host。
  - 验收：package 导出带 `start()`、`stop()`、`request()` 和 `events()` 方法的 `CypheriaRuntime`。
  - 包括：service registry、lifecycle state、runtime info handler、runtime event envelope 和 clean shutdown。
  - 保留：现有 home/path resolution exports。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/runtime test`。

- [x] 将 Cypheria-owned service orchestration 放到 runtime 后面。
  - 验收：runtime 可以连接 database、audit、automation、policy、wallet domain 和 browser domain service boundaries，且不导入 desktop renderer code。
  - 包括：为 `runtime.*`、`wallet.*`、`chain.*`、`policy.*`、`browser.*`、`dapp.*`、`automation.*`、`audit.*` 和 `settings.*` 定义清晰 method namespaces。
  - 验证：`pnpm run ci`、`pnpm build`、runtime 与受影响 package tests。

- [x] 将现有 desktop bootstrap 适配到 runtime host。
  - 验收：Electron main 初始化 `CypheriaRuntime`，通过 runtime request path 读取 runtime info，并在 app quit 时关闭 runtime。
  - 包括：desktop bootstrap tests，以及不重新引入 db-to-runtime dependency 的显式 database path wiring。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/desktop test`。

## SDK

- [ ] 添加 `packages/sdk`。
  - 验收：package 导出公共 `Cypheria` server client。
  - 包括：runtime、wallet、policy、automation 和 agent clients。
  - Agent path：使用版本化 server operation 与 event。
  - 不得导入：`apps/cli`、`apps/desktop`、Electron、`@cypheria/runtime` 或 `@cypheria/codex-bridge`。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/sdk test`。

- [ ] 为 SDK 添加 runtime 和 Codex SDK test doubles。
  - 验收：SDK tests 不需要启动 Codex 或 Electron。
  - 包括：fake runtime client 和 fake agent thread。
  - 验证：`pnpm --filter @cypheria/sdk test`。

## CLI

- [ ] 添加 `apps/cli`。
  - 验收：package 构建无 TUI 的 `cypheria` Node CLI。
  - 包括：argument parsing、server connection/configuration、readable output、JSONL output mode 和 non-zero failure exits。
  - 依赖：`@cypheria/protocol` 与 Node transport。
  - 不得导入：`@cypheria/sdk`、`@cypheria/runtime`、Electron、desktop packages 或 `@cypheria/codex-bridge`。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/cli test`。

- [ ] 实现初始 CLI commands。
  - 验收：`cypheria run`、`cypheria run --jsonl`、`cypheria runtime info`、`cypheria wallet list`、`cypheria policy list`、`cypheria automation run <task-id>` 和 `cypheria doctor` 接入 server operations。
  - 验证：CLI unit tests 和 command smoke tests。

## Marketplace

- [x] 调研并定义 `apps/marketplace`。
  - 验收：中英文配套文档定义类似 OpenAI 的提交/审核/发布平台、强制 ChatGPT/Codex compatibility、GitHub-only open-source `url`/`git-subdir` source、确定性 official repo 同步、App Server 安装、Cloudflare 边界、安全和交付顺序。
  - 验证：配套文档评审与 `pnpm run ci`。

- [ ] 搭建 TanStack Start marketplace Worker。
  - 验收：`@cypheria/marketplace` 使用官方 Cloudflare Vite 集成、自定义 Worker entrypoint、locale-prefixed SSR route、共享 UI primitive、D1 migration、typed binding 和本地测试完成构建与预览。
  - 不得导入：Electron、desktop IPC、`@cypheria/runtime`、`@cypheria/codex-bridge` 或 `@cypheria/db`。
  - 验证：marketplace test/typecheck/build/type generation、`pnpm run ci` 与 `pnpm build`。

- [ ] 实现 marketplace identity、organization、authorization 和 publisher verification。
  - 验收：服务端强制执行 OIDC session、organization、限定 role、publisher identity、domain/organization evidence、step-up action、CSRF protection、rate limit 和 append-only audit event。
  - 验证：role matrix、跨组织隔离、session/CSRF、identity challenge、rate-limit 和 audit tests。

- [ ] 实现 GitHub source verification、plugin draft、validation 与 submission。
  - 验收：只接受具有 immutable SHA、有效 ChatGPT/Codex plugin tree、已验证 publisher relationship，以及覆盖 plugin path 的 OSI-approved license 的 public GitHub `url`/`git-subdir` source；提交冻结不可变 source revision。
  - 验证：repository visibility、ownership、SHA/ref、path containment、submodule/LFS、license coverage、schema、size、stale-scan 和 submission-state tests。

- [ ] 实现 scanning 与 reviewer workflow。
  - 验收：有界 static/MCP scan 通过 Queues 和持久 Workflows 运行；reviewer 检查不可变 evidence，并可要求修改、拒绝或批准，但不自动发布。
  - 验证：SSRF/rebinding/redirect、secret、schema、annotation、timeout、idempotency、workflow-resume、authorization 与 decision-audit tests。

- [ ] 实现 publication 与 public marketplace API。
  - 验收：显式 publication 确定性重新生成受保护 official GitHub repo 的 `.agents/plugins/marketplace.json`，其中仅含 SHA-pinned `url`/`git-subdir` entry；验证 resulting commit 后才通过本地化 route 与 `/api/v1` 暴露 release 和 catalog commit。
  - 验证：schema、stable ordering、expected-head race、GitHub failure、read-after-write、outbox recovery、reconciliation、suspension、withdrawal 与 rollback tests。

- [ ] 在 Desktop 中添加 Cypheria Marketplace discovery/trust provider。
  - 验收：Electron main 获取分页 Cypheria API、固定 official repository identity、通过 `marketplace/add`/`marketplace/upgrade` 注册或升级、校验预期 catalog commit 与 source URL/path/SHA、获得 capability/permission approval，并通过 `plugin/install` 安装。
  - 验证：repository identity、catalog freshness、source mismatch、approval/rejection、install、update、uninstall、advisory、audit receipt 与 renderer-boundary tests。

- [x] 审阅 Desktop 对其他 ChatGPT/Codex 插件来源的现有支持。
  - 验收：文档映射已实现的 generated App Server operation；以 `plugin/list.marketplaces` 作为发现边界，用精确名称白名单识别官方 identity，把其他 marketplace 归入 Personal。
  - 验证：审阅 Desktop main、IPC、renderer、tests 与 generated App Server types。

- [x] 添加 desktop 包内的侧栏收起动画与悬停预览。
  - 验收：原生窗口按钮保持固定，侧栏完全收起，收起工具栏与对话标题联动，悬停预览不改变内容宽度；共享 UI 基础组件保持不变。
  - 验证：desktop 类型检查与构建、Biome，以及 Electron 界面检查。

## Desktop Codex App Server Bridge

- [x] 设计基于 App Server 的 Codex Desktop 风格 permissions。
  - 验收：中英文配对文档精确定义 Codex permission profile、legacy sandbox、approval policy、reviewer、managed requirement、approval request 与 Auto-review 语义，且不把它们扩展为 Cypheria Web3 permissions。
  - 包含：OpenAI 官方文档、生成的 App Server types、本机 Desktop bundle 证据、当前缺口分析、wire mappings、交付顺序与可测试的完成标准。
  - 验证：配对文档 review，并将生成协议与本机 `codex-cli 0.153.4` 对比。

- [x] 在 Desktop 中增加 Codex permission discovery 与 selection。
  - 验收：composer 根据 App Server config、requirements、profiles、model capability 与 cwd 解析 standard modes、named profiles、custom config 与 managed defaults；new、resumed 与 updated tasks 保持有效 choice。
  - 包含：typed IPC、pagination、requirements filtering、profile 与 sandbox 互斥、Full access confirmation、invalidation 与 native Windows readiness。
  - 验证：针对 standard、named、custom、managed、resume、update、stale selection、pagination 与 platform cases 的 bridge/desktop tests；`pnpm run ci`、`pnpm build`。

- [x] 完成 Codex approval 与 Auto-review parity。
  - 验收：command、file 与 additional-permission approvals 使用 method-specific typed projections 与 generated decisions；支持 subset grants 与 scopes；Auto-review lifecycle、strict review 与 exact denied-action retry 可见且 fail closed。
  - 包含：`availableDecisions`、policy amendments、network-specific prompts、resolved-event reconciliation、disconnect/timeout cleanup，以及当前 reviewer aliases compatibility。
  - 验证：broker、IPC、renderer、lifecycle 与 real App Server tests；`pnpm run ci`、`pnpm build`。

- [x] 通过 AI SDK UI stream 完整保留并渲染 Codex turn。
  - 验收：实时会话与历史恢复共用同一个 turn projector；实时流保留所有 turn-scoped update，历史恢复忠实投影完整的持久 App Server turn snapshot；只要 App Server 提供，turn timing/status、item 生命周期及完整 generated item payload、commentary/final-answer phase、reasoning、tool、plan、diff、model reroute 与 terminal progress 就对 renderer 保持可用；会话 UI 以 Codex Desktop 风格将 agent activity 分组折叠，并与 final answer 分离展示。
  - 包括：按 turn/item ID 对账的 typed AI SDK data parts、兼容标准 part 上的 provider metadata、可复用 turn projection tests、基于 AI Elements 的 activity 渲染，以及中英文配套架构文档。
  - 验证：codex-bridge 与 desktop tests/typechecks、renderer build、`pnpm run ci` 和 `pnpm build`。
  - 验证记录：29 个 codex-bridge 测试、89 个 desktop 测试（包含实时 UI-stream reconcile）、严格本地化编译、全仓 CI、全仓构建，以及基于 packaged renderer 的历史 turn 分组/折叠桌面烟测全部通过。

- [x] 完成 Codex App Server capability 与 interaction bridge。
  - 验收：AI SDK V4 provider 保留所有可兼容的 text、reasoning、media、source、tool、usage、metadata、error 与 control surface；启用 experimental App Server API；application-level thread、review、account、plugin、skill、MCP、terminal 与 configuration operation 继续使用直接 typed bridge service；反向 JSON-RPC request 使用 fail-closed desktop interaction broker、typed IPC 和可审计的用户决策。
  - 包含：token usage、audio、generated file、web source、progress result、resume inheritance、stream failure handling、dynamic tool、approval、user input、MCP elicitation，以及成对的中英文 architecture 文档。
  - 验证：bridge 与 desktop protocol tests、interaction 与 renderer-boundary tests、`pnpm run ci` 和 `pnpm build`。
  - 验证说明：experimental protocol generation、26 个 bridge tests、77 个 desktop tests、renderer production build、全仓 CI 与全仓 build 均通过。

- [x] 使用 Lingui 添加桌面端国际化基础设施。
  - 验收标准：Electron 能解析自动检测，并将显式选择作为 `[desktop].localeOverride` 持久化到受管 Codex `config.toml`；renderer 以确定性的 source locale hydrate 预渲染 shell，随后激活对应 Lingui catalog，可无刷新响应式切换，并同步 `lang`/`dir`；桌面壳与语言设置完成本地化。
  - 包含：常规设置页中囊括参考截图全部语言的 Codex 风格可搜索选择器、未内置 catalog 的选择回退英语、类型化 bootstrap 与设置 IPC、locale/TOML 保留测试、提交到仓库的 PO catalog、抽取/编译脚本，以及成对的架构/技术栈文档。
  - 验证：`pnpm run ci`、`pnpm build` 和 `pnpm --filter @cypheria/desktop test`。
  - 验证说明：`pnpm run ci`、构建、desktop tests、严格 catalog 编译和全部 Turbo checks 均通过。

- [x] 将 Codex app-server TypeScript 生成到 `@cypheria/codex-bridge`。
  - 验收：generated files 位于 `packages/codex-bridge/src/generated` 且提交进仓库。
  - 命令：`pnpm --filter @cypheria/codex-bridge generate:codex-types`。
  - 包括：添加 package script，用于显式 Codex 升级时重新生成文件。
  - 不得创建：`@cypheria/codex-protocol`。
  - 验证：`pnpm --filter @cypheria/codex-bridge check`。

- [x] 重构 `@cypheria/codex-bridge` 使用 generated app-server types。
  - 验收：bridge 使用 generated request、response、notification 和 server request types，不再手写 Codex app-server protocol types。
  - 包括：WebSocket transport、initialize/initialized handshake、request/response correlation、notification stream、server request routing、disconnect handling 和 overload retry handling。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/codex-bridge test`。

- [x] 更新 desktop 使用 persistent Codex App Server over WebSocket。
  - 验收：Electron main 以 `CODEX_HOME=$CYPHERIA_HOME/codex` 启动 Codex App Server，通过 `@cypheria/codex-bridge` 连接，并经 typed IPC 向 renderer 暴露 Codex events。
  - 包括：localhost port selection、process lifecycle、readiness、shutdown、stderr logging 和 renderer-safe event mapping。
  - 验证：`pnpm run ci`、`pnpm build`、`pnpm --filter @cypheria/desktop test`，如果 Codex 可用则做本地 desktop smoke test。

- [x] 固定 Codex App Server runtime 与 generated protocol 版本。
  - 验收：workspace 与 desktop 使用精确的 `@openai/codex` 版本；protocol generation 解析该 workspace binary；desktop 在启动前拒绝版本不匹配的 binary。
  - 包括：development package resolution、显式 `CYPHERIA_CODEX_PATH` override，以及从 Electron resources 解析 packaged sidecar。
  - 验证：`pnpm codex:version`、`pnpm run ci`、`pnpm build` 和 desktop tests。

- [x] 添加以对话为中心的 desktop workspace、agent harness connections 与原生模型设置。
  - 验收：左侧导航展示 projects 与最近 threads；主工作区通过 App Server 流式传输 AI SDK UI messages；Connections 按多种 agent harness 组织，并为 Codex 实现 ChatGPT managed 身份验证与经过校验的 OpenAI API key 登录；模型设置支持 OpenAI、Bedrock、Ollama 与 LM Studio。
  - 包括：保存在 `$CYPHERIA_HOME/config/proxy.json` 的全局 system/direct/manual 代理、HTTP/HTTPS/SOCKS5 支持、连接测试、代理变更时重启 harness、无需登录的本地模型、对话中断、model/reasoning/service-tier 控件、automation 管理、隔离 dApp 启动、approval 与 plugin/skill 工作台路由，以及用于 Electron 构建的 client-only route shells。
  - 不包括：在 provider 策略确定前，不实现通用 custom providers 与 OpenCodex 集成。
  - 验证：`pnpm run ci`、`pnpm build` 和 `pnpm --filter @cypheria/desktop test`。

- [x] 对齐会话工作区与本机已安装 ChatGPT desktop 的工作台体验。
  - 验收：会话顶部标题栏与完整功能输入框匹配 desktop 交互模型；长会话使用 TanStack Virtual，且不破坏实时 turn 增长、历史恢复或自动跟随底部；右侧面板可独立调节尺寸；可调节尺寸的底部面板提供持久化多标签 PTY 终端、专用标题栏开关，以及与终端操作相互独立的 `Cmd/Ctrl+J`。
  - 包括：严谨对比 user/assistant turn 呈现、面板 chrome 与空状态；project-scoped terminal IPC 不接受 renderer 自选文件系统路径；在合适处复用 shadcn/ui 和 AI Elements。
  - 验证：162 项 desktop tests、desktop typecheck/build、全仓 CI/build，以及针对 ChatGPT Desktop 26.901.51231 的干净 Electron 交互 smoke tests，覆盖输入框、跨导航与 renderer 重启恢复的 scope-owned prompt 草稿、跨导航保留并在删除/提交/LRU 淘汰时释放的 scope-owned session 附件、与源码一致的纯图片/图片加文本剪贴板路由，以及完整 UTF-8 内容可进入初次 turn、steer 和排队 turn 的 5,000 字符粘贴文本卡片、Chromium 16 像素 rem 基线下与源码一致的 768 像素共享内容列及由 token 独立控制的 14 像素视觉 UI 字号（包括持久化执行的 14→16→14 Appearance 实测，期间 `48rem` 始终为 768 像素）、模型约束的媒体输入（包括系统剪贴板中只含图片的截图，所选模型成功读取其唯一视觉标记）、单次中断的 transport 清理、即时停止状态投影、行内重命名、专用底部面板控件与 `Cmd/Ctrl+J`、带默认底部/右侧位置的独立 `Control+反引号` 终端操作、与源码一致的可滚动标签和固定新增标签控件、关闭最后标签后保留空 dock 直到执行“关闭”，以及从隐藏的空 dock 明确重开时创建 fallback 终端、隐藏/重开底部面板时保留同一 Xterm DOM、终端输出和手动调整后的像素高度、跨会话导航保留已打开 dock、PTY、活动标签、高度和重放输出、高右侧面板中受限且去重的 PTY resize、token 化终端主题与匹配应用包源码的 Xterm 滚动条、冷打开锁底、媒体密集会话跨 thread 精确恢复锚点、即时回到底部、macOS 关闭/重开 renderer 保留、切换页面后后台 turn 继续完成、离开并返回会话后的待回答问题恢复、不放开任意本地文件读取的受限历史生成图片加载、有界持久侧栏未读状态，以及与源码匹配的侧栏宽度约束。另以相同模型、相同提示词新建 item 覆盖 turn，真实完成命令失败、两次文件修改审批、TypeScript 验证、网页搜索、清理及最终 Markdown 渲染；renderer 冷启动后，从 App Server 持久 turn 展开的折叠活动仍完整恢复计划、commentary、命令、文件编辑和网页搜索 item。

- [x] 对齐 Codex Desktop 的侧栏组织与分组控件。
  - 验收：Pinned 与普通对话排序、按项目与单列表组织、项目创建、自定义分组生命周期、分组内新对话和 Recents 新对话，都通过紧凑的 Codex 风格分组标题与菜单正常工作。
  - 包括：经 typed IPC 暴露的 generated experimental App Server 分组方法、持久化非敏感侧栏偏好、虚拟化自定义分组行，以及相对工作台约束的右侧面板尺寸。
  - 验证：desktop typecheck/tests/build，并依据用户提供的 Codex Desktop 参考图完成真实 Electron 视觉与交互 smoke test。

- [x] 补齐 ChatGPT Desktop 中 Projects、Sections 与会话条目的侧栏菜单。
  - 验收：Project 与会话条目按适用范围提供置顶、重命名/编辑、标记已读/未读、移动、复制、Fork、归档、移除和新建会话操作；活跃条目只提供归档而不直接永久删除；自定义 Section 可归档其中会话；破坏性操作要求确认；每次变更都会刷新受影响的虚拟化侧栏分组。
  - 包括：通过 typed IPC 调用 App Server 所有的 thread/project/section 变更、为 App Server 未暴露的 metadata 提供有界 renderer 未读状态、priority/更新时间/创建时间/手动排序、Cypheria 命名空间下的 Project 侧栏元数据，以及 Electron main 根据 Project ID 安全解析并在文件管理器显示项目目录。
  - 验证：desktop tests/typecheck/build、全仓 CI/build，以及对照 ChatGPT Desktop 26.901.51231 的真实 Electron smoke test，覆盖可逆操作与一次性测试数据上的归档/删除流程。

- [x] 补齐 ChatGPT Desktop 设置页中当前可落地的缺口。
  - 验收：设置导航按组展示并支持搜索及桌面快捷键；App Server 已归档会话可搜索、恢复或经确认永久删除；结果在真实 Electron 应用中验证。
  - 包括：typed IPC 后方的 generated `thread/unarchive`、基于 cursor 的已归档会话设置路由、本地化的导航/搜索状态，以及对依赖 ChatGPT 服务或尚未实现桌面基础设施的账户、通知、个性化、语音、存储和更新器控件作明确延后。
  - 验证：严格编译 291 条中英文消息、desktop typecheck、111 项 desktop tests、desktop 与全仓 build、全仓 CI，以及针对 ChatGPT Desktop 26.901.51231 的真实 Electron 创建/归档/搜索/恢复/再次归档/删除 smoke 流程。

- [x] 添加受管 ACP harness 安装与 Connections 终端会话。
  - 验收：Grok Build、Cursor、Gemini CLI、Hermes 和 OpenCode 将最新版本安装到 `$CYPHERIA_HOME` 下，暴露已安装版本与启用状态，通过 ACP v1 初始化检查，并可打开并发的页面级终端标签；Connections 卸载时关闭全部终端。
  - 包括：typed IPC、harness 专用 home、全局代理传递、通过 `HERMES_HOME`/`HERMES_INSTALL_DIR` 约束 Hermes 且不安装 desktop 包，以及包含变化文件与可执行文件哈希的可审计安装收据。
  - 验证：desktop typecheck/tests/build，加真实 Electron Connections smoke check。

- [x] 添加 `@cypheria/acp-ai-provider` ACP 到 AI SDK bridge。
  - 验收：package 使用官方 ACP 1.4 app API，启动或连接 ACP agent，并暴露原生 AI SDK 7 `LanguageModelV4` streaming/generation，以及 ACP callback、lifecycle、configuration、control、transport、event 与 draft-v2 surfaces。
  - 包括：能力感知的 content conversion、安全的默认权限取消、filesystem/terminal/elicitation/ACP-MCP handlers、session 与实验性 controls、usage/provider metadata 保留、在成对 package README 中记录上游来源与 commit、保留上游 MIT 声明，以及来源与协议级 Vitest 覆盖。
  - 验证：package typecheck/tests、workspace CI 与 workspace build。
  - 延后：真实 Codex ACP、Gemini ACP 与 Claude ACP 进程互操作测试。

- [x] 完成 desktop Web3 管理闭环与生产 renderer 启动链路。
  - 验收：可通过 typed IPC-backed screens 使用钱包创建/导入/观察管理、active account context、vault lock 状态、signing policies、待审批决议和 audit records。
  - 包括：OS-backed desktop vault key storage、renderer 不持久化秘密的一次性提交、带持久化拖拽排序和 HD 账户派生的两级钱包/账户虚拟列表、左侧导航待审批计数、通过 privileged `cypheria://` scheme 提供 packaged SPA routes、libSQL native resolution，以及随构建复制 database migrations。
  - 验证：全部 workspace tests、`pnpm run ci`、`pnpm build`，以及 chat workspace 与 wallet route 的真实 Electron smoke checks。

- [x] 实现 desktop 插件与技能管理闭环。
  - 验收：工作台通过 App Server 列出和搜索 marketplace 与 skill；安装、卸载、启用和禁用 plugin；启用和禁用 skill；并经 typed IPC 添加或更新 marketplace source。
  - 包括：renderer-safe Zod projection、source/installed filter、partial-load error、loading/empty state、隔离 Codex home ownership，以及成对的 evidence-based design note。
  - 验证：desktop IPC 与 service tests、`pnpm run ci`、`pnpm build`，以及与官方 desktop reference 的视觉对比。

- [x] 按用户桌面截图重构插件目录、详情与基础管理。
  - 包括：已安装图标栏、平铺搜索、无边框条目、上下文菜单、条件详情分组、输入草稿与独立设置路由。
  - 验证：38 项 desktop 测试、workspace 检查、renderer 构建及浏览器详情/草稿检查。完整视觉对齐仍见 `design-qa.md`。
- [x] 补齐插件设置中的应用/MCP 管理与真实运行可用状态。
  - 包括：五个计数页签、应用开关和外部连接页、MCP 清单/工具、独立服务器启停与 HTTP 添加、OAuth 完成通知、部分状态失败处理。
  - 验证：47 项 desktop 测试、workspace 检查、desktop 构建、浏览器开关/搜索/表单测试，以及桌面和窄窗口归一化截图对比。
- [x] 保留市场真实来源并增加受保护的本地市场移除。
  - 包括：基于返回 marketplace record 与受信任白名单的 Public/OpenAI/Personal 发现、每个 personal marketplace 独立分区、移除确认与主进程二次校验；存在已安装插件时须先明确卸载。
  - 验证：desktop 服务测试/类型检查，以及浏览器预览取消、移除和来源筛选。未移除用户真实市场。
- [ ] 完成其余桌面插件对齐：技能录制及剩余截图状态。在 Electron 中验证真实登录连接授权。

## Runtime Web3 能力

- [x] 明确 network 与 RPC 架构。
  - 验收：中英文设计文档分析 Archmage-X 先例，并定义 canonical chain identity、package boundaries、catalog reconciliation、persistence、受保护 RPC credentials、endpoint probing/routing、origin-scoped dApp selection、failure semantics 与 V1 exclusions。
  - 验证：成对文档审查、`pnpm run ci`。

- [x] 添加 `@cypheria/network-core` 与 bundled network catalog。
  - 验收：严格的 EVM/Solana chain identity、network、explorer、endpoint、public projection 与 protocol-conversion schema 取代无类型或混用的 chain identifier。
  - 包括：stable IDs、canonical chain keys、immutable identity、URL normalization、精简且经过审核的 built-ins 与 catalog fixtures。
  - 验证：network-core tests、`pnpm run ci`、`pnpm build`。

- [x] 持久化 network configuration 并保护 RPC credentials。
  - 验收：libSQL 保存 networks、ordered endpoints、revisions 与 origin-scoped contexts；受保护连接材料位于普通列之外的 `$CYPHERIA_HOME/config/network-credentials`。
  - 包括：migrations、catalog reconciliation、redacted projections、optimistic concurrency、不级联删除 wallet/history 的行为，以及 OS-backed credential protection。
  - 验证：database、credential-store、migration 与 recovery tests；`pnpm run ci`、`pnpm build`。

- [x] 实现 runtime network manager 与 RPC router。
  - 验收：runtime probe endpoint identity、追踪可丢弃 health、选择符合 purpose 的 endpoint、只重试安全 read、保持 operation stickiness，并在 broadcast 结果不明确时报告状态而不盲目重试。
  - 包括：SSRF destination policy、DNS/redirect 检查、timeout、response/concurrency bound、redacted audit 与稳定 network errors。
  - 验证：使用本地 fake EVM/Solana RPC server 的 runtime unit/integration tests；`pnpm run ci`、`pnpm build`。

- [x] 将 wallet、policy、automation 与 dApp boundary 迁移到 canonical chain identity。
  - 验收：chain account、active wallet context、signing intent、policy、automation scope、permission 与 event 使用 `ChainIdentity`/`ChainKey`；active network identity 必须与所选 chain account 匹配。
  - 包括：data migration，以及 EIP-1193 hex ID 与 Solana Wallet Standard identifier 的 compatibility adapter。
  - 验证：wallet-core、policy-engine、automation-core、wallet-provider、database、runtime 与 desktop IPC tests。

- [x] 添加 origin-scoped network add/switch flow 与 desktop management UI。
  - 验收：每个 dApp origin 独立选择 Ethereum/Solana network；EIP-3085 add 与 EIP-3326 switch request 必须经过 probe 和 approval；desktop 管理 network/endpoint 排序、enabled state、health 与脱敏 credential。
  - 包括：typed IPC、只在成功选择后发送 provider event、built-in disable/custom delete 行为与 approval metadata diff。
  - 验证：runtime、desktop、provider 与真实 sandboxed Electron tests；`pnpm run ci`、`pnpm build`。

- [x] 采用 Drizzle + libSQL 本地数据库适配器，并确定钱包架构。
  - 验收：数据库服务使用 `@libsql/client` 替代 `better-sqlite3`；持久化 API 全部异步；中英文钱包设计文档明确公开数据、加密 vault、内存和签名边界。
  - 验证：`pnpm run ci`、`pnpm build`、数据库与 desktop tests。

- [x] 替换 wallet domain baseline。
  - 验收：`@cypheria/wallet-core` 在与 storage 解耦的前提下建模 HD、private-key、private-key-group、watch 和 watch-group 钱包；钱包 kind 决定 vault 与 read-only 能力。
  - 包括：Zod boundary schemas、稳定标识、wallet/account/chain-account 层次、fingerprints、生命周期状态、派生方案和 renderer-safe projections。
  - 验证：`pnpm --filter @cypheria/wallet-core test`、`pnpm run ci`、`pnpm build`。

- [x] 添加钱包公开状态持久化。
  - 验收：`@cypheria/db` 通过 Drizzle + libSQL 持久化 wallets、wallet accounts、chain accounts 和 HD derivation schemes，且不包含秘密材料。
  - 包括：migrations、约束、repository APIs、恢复状态和内存数据库 tests。
  - 验证：`pnpm --filter @cypheria/db test`、`pnpm run ci`、`pnpm build`。

- [x] 实现加密钱包 vault。
  - 验收：钱包秘密以每钱包一个原子 vault 文件的形式保存在 `$CYPHERIA_HOME/vault`，使用根植于 OS-backed key storage 的每 entry 密钥加密，并且只解密到 runtime 内存。
  - 包括：窄边界 ethers Web3 Secret Storage codec、key-provider abstraction 与 test double、atomic writes、orphan recovery、lock、unlock、delete 和脱敏错误。
  - 验证：wallet vault tests、`pnpm run ci`、`pnpm build`。

- [x] 实现 vault 钱包与观察钱包管理。
  - 验收：runtime 可以生成/导入 HD 钱包、导入单个/分组私钥、管理单个/分组观察钱包、使用 viem 派生 EVM 账户、检测重复、列出 renderer-safe 状态并暴露 active account context。
  - 包括：新生成钱包快速初始化、导入成功前完成持久化、地址一致性检查、rename/delete 和 audit events。
  - 验证：runtime、wallet、database 与 vault tests。

- [x] 将钱包 signer 接入 signing-intent pipeline。
  - 验收：调用方获得签名能力而不是秘密材料；每次 message、typed-data 和 transaction 签名都绑定已批准 intent 并写入 audit。
  - 包括：viem signing adapters、signer/address 一致性检查、lock behavior、replay protection，并确保 renderer、dApp、agent 和 automation contexts 均不接触私钥。
  - 验证：runtime、policy、wallet 与 desktop IPC tests。

- [x] 实现 policy runtime service。
  - 验收：runtime 可以 list、validate、create、update、disable 和 evaluate signing policies。
  - 验证：runtime 和 policy-engine tests。

- [x] 实现 signing intent 与 approval runtime flow。
  - 验收：dApp、automation 和 agent contexts 可以创建 signing intents；每个 intent 都经过 policy evaluation 且可审计。
  - 验证：runtime、policy、db 和 desktop IPC tests。

- [x] 实现 wallet-provider 与 dApp browser runtime service。
  - 验收：desktop 可以创建 origin-isolated dApp sessions；暴露并发现 Ethereum 与 Solana providers；持久化 protocol-scoped permissions；转发常用 Ethereum read-only RPC；投递 scoped provider events；并让 EVM 或 Solana signing 经过 policy-backed intents 与 injected executors。
  - 验证：wallet-provider、database、runtime、desktop controller 与真实 sandboxed Electron discovery tests。

- [x] 实现 automation runtime service。
  - 验收：runtime 可以 create、list、run、pause、resume 和 inspect automation tasks/runs。
  - 包括：tasks 可以调用 Codex SDK 或创建 signing intents，但不能绕过 policy。
  - 验证：automation-core、db、runtime 和 desktop tests。

## Review Rule

每完成一个 todo item 后：

- 停下来请求用户 review，再开始下一项。
- 运行相关验证命令。
- 如果 behavior、architecture、command、public interface、package boundary 或 runtime path 变化，同步更新英文和中文文档。
- 保持 commit 聚焦在已完成项上。
