---
title: 开发指南
---

# 开发指南

本文是工作区、工具链、生成产物和验证流程的权威参考。产品所有权见[架构](architecture.zh-CN.md)。

## 环境要求

- Node.js 24 或更高版本
- 根目录 `packageManager` 固定的 pnpm 11.1.3
- 开发 `apps/relay`、`apps/node-repl` 与 `apps/browser-extension-host` 所需的 Go 1.25
- 重新生成 Codex App Server 产物时所需的兼容 Codex 二进制文件

JavaScript 和 TypeScript 工作区命令统一使用 pnpm。仓库使用 Turborepo 编排任务，使用 Biome 格式化和 lint。

## 工作区

已实现应用：

| 工作区 | 职责 |
| --- | --- |
| `apps/server` | Hono/Node.js Server、Agent adapter、持久化、Schedules、Web3 和 web 托管 |
| `apps/desktop` | Electron main/preload 和 TanStack Start 桌面客户端 |
| `apps/expo` | Expo Router 基础和静态 web 导出 |
| `apps/cli` | 非 TUI 协议客户端和本地 Server 生命周期命令 |
| `apps/relay` | Go 加密 relay 数据平面 |
| `apps/cua` | Computer Use 运行时：`cua_repl` 启动器与 `cua` API、Server 端各界面的 host、内嵌 cua-driver 的监管器，以及隐藏 `cua` 插件的模板 |
| `apps/node-repl` | Go node_repl MCP 服务端与 supervisor，以及其内嵌的 TypeScript kernel，用于持久化沙箱 JavaScript 执行 |
| `apps/browser-extension` | Cypheria Chromium 扩展（WXT，Manifest V3），以及它与原生宿主和 Desktop 共用的协议 |
| `apps/browser-extension-host` | 把扩展消息转发给 Desktop 的 Go 原生消息宿主 |
| `apps/website` | 部署于 Cloudflare Workers 的 TanStack Start 官网与 Fumadocs 文档站 |

已实现包：

| 工作区 | 职责 |
| --- | --- |
| `packages/protocol` | 公开协议、Zod 校验、生成的 Codex 产物 |
| `packages/client` | 公开 TypeScript SDK、连接生命周期和领域 facade |
| `packages/db` | SQLite Schema、迁移和 repositories |
| `packages/storage` | 跨平台客户端键值、Replica、附件和 Jotai adapter |
| `packages/web3` | 纯 Web3 领域模块 |
| `packages/relay` | 配对、E2EE 和 relay 传输工具 |
| `packages/ui` | 共享 UI 与会话展示原语 |

内置插件：

| Workspace | 职责 |
| --- | --- |
| `plugins` | 内置的 `cypheria-bundled` marketplace：Codex 与 Claude 的 marketplace 文件，与其列出的插件放在一起 |
| `plugins/cypheria-app-tools` | App tools 插件：manifest 与 MCP relay，无需构建 |
| `plugins/code-review` | `code-review` 插件及其包：manifest、`src/server` 中的 MCP relay，以及 `src/app` 中的代码审查 MCP App，构建为 `dist/app.html` |
| `plugins/browser`、`plugins/chrome`、`plugins/computer-use` | Computer Use 各界面的 manifest 与图标；运行时位于 `apps/cua` |

在源码 checkout 中，Agent 从 `plugins/` 安装内置插件。Server 构建会在 `apps/server/dist/marketplace` 中组装 marketplace，并以与 `node plugins/code-review/scripts/build.mjs --plugin-dir <dir>` 相同的方式打包 `code-review`，因此安装后的插件只包含 manifest、relay 与构建后的 App。

未来 Marketplace 路由属于 `apps/website`；当前应用没有 Marketplace 路由、账户系统、API、schema 或 Cloudflare 存储 binding。

## 安装与验证

```sh
pnpm install
pnpm run docs:check
pnpm run check
pnpm run ci
pnpm run build
```

各命令职责不同：

- `docs:check` 校验内部文档和生成的 Codex API 参考是否漂移。
- `check` 通过 Turborepo 运行工作区类型和包检查。
- `ci` 运行文档检查、Biome CI 和工作区检查。
- `build` 生成所有可构建工作区的输出。
- `format` 写入 Biome 格式；`lint` 报告 Biome lint 结果。

迭代时使用 package filter：

```sh
pnpm --filter @cypheria/server test
pnpm --filter @cypheria/protocol check
pnpm --filter @cypheria/client test
pnpm --filter @cypheria/desktop typecheck
pnpm --filter @cypheria/website check
pnpm --filter @cypheria/cypheria-relay test
```

## 本地开发

使用打包后的 Server CLI 前先构建 Server：

```sh
pnpm --filter @cypheria/server build
pnpm --filter @cypheria/server server start
```

常用开发进程：

```sh
pnpm dev:desktop
pnpm dev:desktop:stop
pnpm --filter @cypheria/server dev
pnpm --filter @cypheria/desktop dev
pnpm --filter @cypheria/expo dev
pnpm --filter @cypheria/website dev
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single
```

`pnpm dev:desktop` 是集成的 Desktop 开发命令。它会构建 Electron main 和 preload 入口，启动受监视的 Server 与 Vite renderer，等待二者就绪后再打开开发应用。Renderer 变更使用 Vite HMR，Server 变更由 Server watcher 处理；修改 Electron main 或 preload 后需要重新启动该命令。该命令只为它启动的 Server 进程授予 `http://127.0.0.1:5173` WebSocket 访问权，同时保留显式配置的其他 allowed origins。既可以在原终端中停止，也可以在另一个终端运行 `pnpm dev:desktop:stop`；两种方式都会终止完整的 Server、Vite 和 Electron 进程树。打包后的 Desktop 仍加载 `cypheria://app`，不会信任 Vite origin。

仅在测试一次性构建的 renderer、而不是 HMR 工作流时，才使用 `pnpm --filter @cypheria/desktop dev`。

两个 Desktop 命令都会把浏览器扩展构建到 `apps/browser-extension/.output/chrome-mv3`，把其原生宿主构建到 `apps/browser-extension-host/dist/<platform>-<arch>/`；Desktop 启动时安装宿主并向你的浏览器注册它。要使用扩展，请在浏览器的扩展程序页面把该目录作为已解压的扩展程序加载，见[浏览器扩展](features/browser-extension.zh-CN.md#开发)。

开发版会在 `/chat-demo` 显示 **Chat Demo** 导航项：它用 fixture 数据交互展示共享 Chat 组件，不连接 Agent runtime，覆盖虚拟化长 transcript、每类 Timeline item、每个 panel tab、工作区 Files 标签页，以及 composer 的引用与附件。打包版会隐藏该入口并重定向路由。删除计划见[路线图](roadmap.zh-CN.md#desktop)。

产品 CLI 单独构建：

```sh
pnpm --filter @cypheria/cli build
pnpm --filter @cypheria/cli exec cypheria --help
```

生命周期命令和运行目录见 [Server](server/runtime.zh-CN.md)。

Website 的英文内容位于根路径，简体中文位于 `/zh-CN`。Lingui 管理营销文案；Fumadocs 直接消费 `docs/*.md` 及其 `.zh-CN.md` companion。`pnpm --filter @cypheria/website build` 会严格编译 catalog、预渲染所有营销与文档路由、输出静态 ZBSearch 索引，并构建 Worker fallback。可用 `pnpm --filter @cypheria/website exec wrangler dev` 启动与生产形态一致的本地运行时。

## 生成产物

Codex App Server TypeScript 类型、JSON Schemas、校验器、响应映射和 API 参考均由已安装的 Codex 二进制文件生成：

```sh
pnpm codex:generate
```

生成输出提交在 `packages/protocol/src/generated/codex/` 和两份 Codex API 参考页面中。不要手工编辑。CI 会检查 API 页面是否与生成器一致；完整协议再生成需要兼容的本地 Codex 二进制文件。

生成器会把 Rust 64 位整数归一化为 JSON `number`，为 NodeNext 消费者补充显式 TypeScript 扩展名，并启用 Cypheria 使用的实验 API。

稳定 ACP registry 快照及其运行时 Agent ID allowlist 同样属于生成产物：

```sh
pnpm --filter @cypheria/protocol generate:agent-acp-registry
```

该维护者命令会下载、校验并规范化 registry，然后写入 `packages/protocol/src/generated/acp/registry.json`，并把审核子集写入 `agent-ids.ts`。每个批准的 ID 都必须存在于快照中。两个文件必须一起提交和审查。普通构建与检查只校验本地快照，绝不会获取 registry 网络数据。

node_repl kernel 以 TypeScript 编写，位于 `apps/node-repl/src/`，由 Vite 打包到 `apps/node-repl/internal/assets/files/`，供 Go 二进制内嵌。`meriyah` 等第三方依赖进入经过压缩的 `vendor.js` chunk，其许可声明位于 `THIRD_PARTY_LICENSES.txt`；Cypheria 自身源码保持未压缩，便于调试：

```sh
pnpm --filter @cypheria/node-repl build:js
```

除 `package.json` 外，打包产物均被 Git 忽略。该包的 `build`、`check` 与 `test` 脚本会在运行 Go 之前重新生成产物，因此只有直接调用 `go` 时才需要先运行 `build:js`。

Computer Use 的启动器与运行时由 Vite 构建到 `apps/cua/dist`。原生应用操控需要固定版本的 cua-driver 发行包，维护者在构建 Desktop 前以摘要校验的方式获取它，详见 [Computer Use](features/computer-use.zh-CN.md#桌面应用)：

```sh
pnpm --filter @cypheria/cua build
pnpm --filter @cypheria/cua fetch:cua-driver
```

浏览器引擎从固定版本的 `playwright-core` 中 vendor 部分 Playwright 代码；修改该版本后运行 `pnpm --filter @cypheria/cua vendor:playwright`。

## 测试策略

- Protocol 测试校验 Schema、版本协商、harness adapter 和 Timeline 投影。
- Client 测试校验传输、请求生命周期、领域 facade、relay 传输和错误归一化。
- Server 测试覆盖 Agent runtime、按需 harness catalog 缓存与失效、配置、Projects 与 Threads、Schedules、Integrations、Web3 服务和运维。
- Desktop 测试覆盖 Server 管理、preload 契约、扁平 Settings 导航模型、Sidebar 数据适配和会话行为。Settings 导航与 model catalog 使用彼此独立的 virtualizer；Agent 子项不得引入嵌套导航 virtualizer。
- Relay 测试覆盖密码学和数据平面行为。

测试应通过公开边界进行，不得导入其他工作区的私有文件。原生 Agent 事件适配优先使用 fixture replay。

## 依赖规则

- 客户端依赖 `@cypheria/client` 和 `@cypheria/protocol`，不依赖 Server 内部实现或数据库。
- 会话消费者直接使用 `@cypheria/client`；项目不维护 AI SDK 兼容层。
- Renderer 不导入 Agent SDK、生成的原生协议、数据库代码或特权 Web3 服务。
- 领域包不依赖 `apps/server`；Server 通过显式注入组合它们。
- CLI 直接使用 `@cypheria/client`，不依赖 Electron 或 Desktop。

## 文档流程

文档按领域放在 `docs/` 下：`server/` 是 Server 进程及其契约，`agents/` 是 harness、Codex 与插件，`desktop/` 是 Desktop 客户端，`features/` 是横跨 Server 与客户端的产品功能，`design/` 是视觉系统，`planned/` 是尚未实现的设计。[架构](architecture.zh-CN.md)、本指南和[路线图](roadmap.zh-CN.md)位于顶层。文件名使用简短的小写名词，不重复所在目录的前缀。

英文是内容源，每份维护中的产品页面都有完整的 `.zh-CN.md` companion，并保持相同标题拓扑。一个主题只由一份文档负责，其他文档通过链接引用。文档描述的是 Cypheria。Cypheria 参照 ChatGPT 或官方 Codex 桌面版的地方可以写明，但具体的 ChatGPT 版本、bundle 名称和本机分析路径属于 ChatGPT 分析笔记，不放在这里。

修改文档后运行 `pnpm docs:check`。生成页面通过生成器更新。当前行为不添加状态标记；计划工作和生成参考必须明确标注。历史变更记录属于 Git，不属于产品文档。

## 贡献流程

1. 从 [路线图](roadmap.zh-CN.md) 或已确认 issue 中选择一个可评审、可测试的事项。
2. 修改公开行为或边界前先检查仓库中的实际实现。
3. 行为、架构、命令或接口变化时，在同一变更中更新中英文文档。
4. 先运行最小相关检查；跨工作区变更再运行根 CI。
5. 保持提交聚焦并签名。

不要提交密钥、本地应用目录、构建输出、缓存或依赖目录。
