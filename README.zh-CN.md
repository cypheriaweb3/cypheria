# Cypheria

Cypheria 是一款 local-first、跨平台的 Web3 Agent 工作台。特权 Cypheria Server 统一持有 Agent runtime、Project、Thread、Canonical Timeline、Schedule、钱包、策略执行与审计数据；Desktop、Expo、CLI 与未来客户端使用同一套版本化协议。

## 已实现能力

- 基于 Hono/Node.js 的受监管 Server，提供 HTTP、WebSocket、配置、诊断与内置 Web hosting。
- Codex、Claude、Pi、OpenCode 第一方 adapter，以及基于 registry 的 ACP Agent。
- 持久化 Projects、Threads、Sections、Canonical Timeline、interaction、terminal 与 artifact。
- 作为公开 TypeScript SDK 的 `@cypheria/client`，直接提供 Thread、Timeline、interaction 与 harness facade。
- Electron + TanStack Start Desktop，保留既有 Sidebar 与会话工作台体验，并提供本地 Git Review、工作树与代码审查。
- Computer Use：Agent 通过同一个 `cua_repl` 运行时操作内置浏览器、MCP App、用户的 Chromium 浏览器和桌面应用。
- 跨 Agent 的 Skills、MCP 与插件，以及 OpenAI MCP Extensions 定义的界面。
- Server 所有的 Schedule、Web3 network、wallet、signing policy、dApp session、approval 与 audit record。
- 非 TUI CLI，以及可选的端到端加密 Relay。
- 可构建 iOS、Android 与静态 Web 的 Expo Router 基础；这些端的产品功能目前有意保持精简。
- 双语 TanStack Start 官网与 Fumadocs 文档站，由 Cloudflare Worker 承载预渲染页面。

Cypheria 不 fork Agent runtime。Harness 专属进程和协议只存在于 Server adapter 后方；Client 面向 Cypheria Agent、Thread、Timeline、Integration、Schedule 与 Web3 contract 工作。

## 架构概览

```text
Desktop / Expo / CLI / 其他客户端
              |
       @cypheria/client
              |
     @cypheria/protocol
              |
        apps/server
       /           \
Agent adapters   Cypheria runtime
                 Web3 / schedules / DB

远程客户端可通过 @cypheria/relay -> apps/relay -> apps/server 连接。
```

Electron 负责窗口、内置浏览器标签页与 dApp 钱包 provider 的加固边界、preload bridge、Desktop 本地设置、更新与操作系统集成。共享产品状态和特权操作属于 Server。

详见[架构指南](docs/architecture.zh-CN.md)与[文档索引](docs/README.zh-CN.md)。

## 仓库结构

应用位于 `apps/`，共享包位于 `packages/`，随附插件位于 `plugins/`；每个工作区及其职责见[开发指南](docs/development.zh-CN.md#工作区)。Marketplace 计划作为 `apps/website` 内的动态功能实现；当前尚无 Marketplace 路由、账户、API 或存储 binding。边界见 [Marketplace 设计](docs/planned/marketplace.zh-CN.md)与[路线图](docs/roadmap.zh-CN.md)。

## 开发

环境要求：

- Node.js 24 或更新版本
- pnpm 11
- Relay、node_repl 和浏览器扩展的原生宿主需要 Go 1.25

```sh
pnpm install
pnpm run ci
pnpm build
```

常用入口：

```sh
pnpm --filter @cypheria/server build
pnpm --filter @cypheria/server server start
pnpm --filter @cypheria/desktop dev
pnpm --filter @cypheria/expo dev
pnpm --filter @cypheria/website dev
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single
```

Cypheria 的本地数据位于 `$CYPHERIA_HOME`，默认是 `~/.cypheria`。Cypheria 管理的 Codex 进程只把 `$CYPHERIA_HOME/agents/codex/home` 用作 `CODEX_HOME`，不会修改用户默认的 Codex home。

开发命令、生成代码流程与验证规则见[开发指南](docs/development.zh-CN.md)。

## 安全模型

- Renderer 与 dApp 页面不会获得私钥或数据库直接访问能力。
- Agent 与 Schedule 只提交签名意图；Server 必须通过策略评估每个意图。
- Auto-signing 默认关闭，必须通过显式策略开启。
- dApp 钱包 session 与权限按 origin 隔离；网页标签页永远不会获得钱包 provider。
- 签名、策略决策、Schedule run 与交易结果都可审计。

详见 [Web3 指南](docs/features/web3.zh-CN.md)与[架构安全边界](docs/architecture.zh-CN.md#信任边界)。

## 文档

从[文档索引](docs/README.zh-CN.md)开始。英文是权威来源；每份维护中的产品文档都有完整的简体中文版本。

## License

MIT
