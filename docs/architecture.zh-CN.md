---
title: 架构
---

# 架构

Cypheria 是一个本地优先系统，由一个特权 Server 和多个非特权客户端组成。本文只定义进程所有权、数据流和信任边界。Wire 字段见[协议](protocol.zh-CN.md)，持久化细节见[数据库](database.zh-CN.md)，命令见[开发指南](development.zh-CN.md)或 [Server](server.zh-CN.md)。

## 系统模型

```text
Desktop ─┐
Expo ────┼─ @cypheria/client ─ Cypheria 协议 ─ apps/server ─ Agent 进程
CLI ─────┘                                      │
                                                ├─ SQLite 与配置
远程客户端 ─ E2EE ─ relay ──────────────────────┤
                                                └─ Web3 与 Schedule 运行时
```

Server 是共享产品状态的唯一权威。客户端可以管理本地 Server 进程，但不会因此获得 Server 权限。

## 进程所有权

### Server

`apps/server` 负责：

- Agent 注册、安装、启用、进程生命周期、健康状态和原生协议适配器。
- Projects、Threads、Sections、Turns、Interactions 和 Canonical Timeline。
- 共享 Agent 设置与集成状态。
- Schedules、Web3 服务、特权 Terminal、本地 Git 执行、Artifacts 和审计记录。
- 数据库访问、迁移、配置加载、日志和版本化客户端连接。
- 托管当前 Expo web 静态导出。

Agent 原生事件在此边界归一化。原生载荷可以为诊断保留，但客户端不得把它作为持久会话模型。

### Desktop

`apps/desktop` 是使用 TanStack Start renderer 的 Electron 应用。Electron main 确保兼容的本地 Server 可用，并负责窗口、隔离的 dApp `WebContents`、preload IPC、桌面本地设置、更新、安全存储和操作系统集成。Renderer 通过 `@cypheria/client` 使用共享产品能力。

### Expo 与 CLI

`apps/expo` 是面向 iOS、Android 和静态 web 的可构建 Expo Router 基础，还不是完整移动端产品。`apps/cli` 是非 TUI 客户端和 Server 生命周期入口。两者都不得导入 Server 内部实现或 Agent SDK。

### Relay

`apps/relay` 转发不透明的加密 WebSocket 帧。`@cypheria/relay` 提供传输无关的配对、加密和 relay URL 工具。Relay 无法查看应用载荷，也不是产品状态来源。

### Website

`apps/website` 是作为单个 Cloudflare Worker 部署的 TanStack Start 官网与文档应用。营销页与 Fumadocs 页面经过预渲染并由静态资源层优先返回；Worker 保留为未来 Marketplace 页面与 API 的服务端渲染边界。它不连接本地 Cypheria Server，也不导入其内部实现。

## 包边界

- `@cypheria/protocol` 负责版本化公开契约、运行时校验和生成的上游协议产物。
- `@cypheria/client` 是公开 TypeScript SDK，负责连接和领域 facade，不依赖 Electron 或数据库。
- `@cypheria/db` 负责 Server 使用的 SQLite Schema、迁移基线和 repositories。
- `@cypheria/web3` 包含纯 Network、Policy、Wallet、Provider 领域逻辑；特权编排仍在 Server。
- `@cypheria/ui` 包含可复用展示组件，包括不依赖协议的会话、面板、通知和 artifact surface。

## 主要数据流

### 会话

1. 客户端创建或选择 Cypheria Thread，通过 `@cypheria/client` 提交输入。
2. Server 解析 Thread 对应的 Agent，启动或复用 adapter runtime，并记录 turn。
3. Adapter 校验原生边界，并把 item 生命周期更新转换为稳定的 Canonical Timeline identity。阻塞式反向请求成为带目标的 interaction；goal、queue、usage、rate limit、环境和安全状态保留为可查询 runtime state，不伪装成消息。
4. Server 持久化 Timeline 事件，并通过 epoch 与 cursor 发布有序更新。
5. Desktop 直接消费 Thread API。其无框架 controller 会恢复 epoch 变化或序列缺口，React 通过 `useSyncExternalStore` 渲染同一条持久 Timeline；Codex 专属控制使用带类型的 `client.harnesses.codex` facade。

### Desktop 启动

1. Electron main 发现兼容 Server，或启动受监管的本地实例。
2. 暴露连接配置前等待健康检查和协议兼容性通过。
3. Renderer 通过 `@cypheria/client` 连接。
4. 关闭时只回收由当前 Desktop 拥有且可安全停止的 Server。

### 签名

1. 客户端、Agent、Schedule 或 dApp 提交签名意图。
2. Server 解析钱包和网络上下文并评估策略。
3. 在需要时请求审批。
4. 签名在特权 runtime 中完成；密钥材料不会进入 renderer、Agent 或 dApp 页面。
5. 策略决定、签名、失败和交易结果都会被审计。

### 远程连接

配对在客户端与 Server 之间建立端到端密钥。Relay 只路由密文。应用认证、协议校验、防重放和产品状态仍由端点负责。

## 信任边界

- Server 进程是特权进程，必须校验所有网络、文件系统、Agent、插件、Schedule 和 Web3 边界。
- Desktop renderer、Expo、CLI、插件、Agent 进程和 dApp 页面都是受限 API 的不可信调用方。
- Electron preload 只暴露狭窄的类型化接口；renderer 不获得 Node.js 能力。
- dApp origin 默认使用隔离 session，不共享 cookie、provider 权限或注入状态。
- 私钥加密保存于普通 SQLite 表之外，只能由 Server 所有的签名服务使用。
- Server 插件运行在受控子进程中。Desktop 扩展不获得环境级文件系统、Node.js 或密钥权限。

## 部署形态

当前产品是本地优先的：单个用户控制的 Server 拥有权威存储。Desktop 通常监管该 Server，CLI 和 Expo 也可以连接。远程访问使用可选 relay，但不会把执行和状态转移到 relay。

公共 Website 使用 Cloudflare 静态资源与 Worker fallback。英文页面位于根路径，简体中文页面位于 `/zh-CN`；静态文档搜索从同一组仓库 Markdown 源生成。

云端 Agent 执行、多 Agent 编排以及更强的多用户授权系统尚未实现，需要未来单独设计协议和安全模型。

## 计划边界

- `apps/website` 内的 Marketplace 路由：公开发现以及需要认证的 publisher、reviewer 界面。其数据与授权独立于本地 Server，插件扫描由另一个受限 Worker 执行。
- 在 Desktop 体验成熟后扩展 Expo 产品能力。

仍未完成的工作只在 [Todo](todo.zh-CN.md) 中跟踪。
