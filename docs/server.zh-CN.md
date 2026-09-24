---
title: Server
---

# Server

`apps/server` 是 Cypheria 的特权进程边界，负责共享状态、Agent runtime、持久化、Schedules、Web3 执行和版本化客户端连接。所有权见[架构](architecture.zh-CN.md)，wire 契约见[协议](protocol.zh-CN.md)。

## 进程模型

```text
cypheria-server CLI
  └─ supervisor
      ├─ PID 所有权、worker 心跳、重启预算、日志汇聚
      └─ worker
          ├─ Hono HTTP 与 WebSocket Server
          ├─ session registry 和 Cypheria 服务
          ├─ Agent runtimes 与 adapters
          └─ 内嵌 Expo web 导出（仅独立 Server）
```

Supervisor PID 稳定，worker 可替换。它使用有界重启退避、检测 worker 心跳丢失、防止孤儿 worker，并在优雅关闭超时后升级终止。Worker 在报告就绪前初始化 runtime、repositories、固定 Pinned Section、integrations 和可恢复 schedules。

## 生命周期命令

构建 `@cypheria/server` 后：

```sh
pnpm --filter @cypheria/server server start
pnpm --filter @cypheria/server server start --foreground
pnpm --filter @cypheria/server server status
pnpm --filter @cypheria/server server restart
pnpm --filter @cypheria/server server stop
pnpm --filter @cypheria/server server stop --if-idle
```

存在活动客户端时，`--if-idle` 会保留 Server。Desktop 遵循同一所有权原则：复用兼容进程，且只在安全时停止自己启动的实例。Desktop 启动的 Server 进程会禁用内嵌 web 托管；Desktop 复用的兼容独立 Server 则保留其独立选择的配置。

## 运行目录

`CYPHERIA_HOME` 选择应用主目录，默认为 `~/.cypheria`。

```text
$CYPHERIA_HOME/
  codex/     Cypheria 管理的 Codex home
  config/    config.json、PID、Server 身份和 relay key
  db/        SQLite 数据库
  logs/      Server 与 runtime 日志
  vault/     加密钱包 vault 数据
  cache/     可丢弃缓存和托管工具链
  browser/   dApp session 元数据
```

Server 只解析一次根目录，再把派生路径传给各服务。Cypheria 管理的 Codex 进程使用 `CODEX_HOME=$CYPHERIA_HOME/codex`；不会读取或修改用户默认 Codex home。

## 配置

期望的共享配置存储在 `$CYPHERIA_HOME/config/config.json`，当前 Schema 版本为 1。产品尚未发布，因此它就是当前 baseline，不执行旧配置迁移。文件不存在时使用安全默认值且不主动写文件。Patch 会先作为完整文档校验，再以仅所有者可读写权限原子写入。

该文档包含 listener、CORS、消息限制、session timeout、shutdown、relay、内嵌 web、日志和共享 Agent 设置。非 Codex harness 发现出的新 session 默认值按 Agent ID 存在 `agents.defaults`；Codex 全局设置保存在隔离的原生 `config.toml` 中。`CYPHERIA_SERVER_TOKEN` 等密钥只存在于环境变量中，设置 API 不会返回它们。

配置响应区分：

- 磁盘保存的期望值；
- 当前 worker 使用的不可变启动快照；
- 需要重启的路径；
- 当前被环境变量覆盖的路径。

Desktop 外观、布局、快捷键、窗口状态、更新偏好和操作系统集成继续保存在 Electron 本地 `config.json`，不属于 Server 配置。

## 环境变量覆盖

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `CYPHERIA_HOME` | `~/.cypheria` | 应用主目录 |
| `CYPHERIA_LOG_LEVEL` | `info` | 控制台日志级别 |
| `CYPHERIA_LOG_FILE_LEVEL` | `info` | 文件日志级别 |
| `CYPHERIA_LOG_FILE_PATH` | `$CYPHERIA_HOME/logs/server.log` | 日志文件路径；相对路径从 `CYPHERIA_HOME` 解析 |
| `CYPHERIA_LOG_ROTATE_SIZE_MB` | `10` | 单个日志文件的最大 MiB 数 |
| `CYPHERIA_LOG_ROTATE_COUNT` | `3` | 保留的轮转文件数 |
| `CYPHERIA_SERVER_HOST` | `127.0.0.1` | 监听地址 |
| `CYPHERIA_SERVER_PORT` | `6768` | 监听端口；`0` 请求临时端口 |
| `CYPHERIA_SERVER_TOKEN` | 未设置 | Bearer 凭证；非 loopback 监听时必需 |
| `CYPHERIA_SERVER_ALLOWED_ORIGINS` | 未设置 | 逗号分隔的浏览器 origin allowlist |
| `CYPHERIA_SERVER_MAX_MESSAGE_BYTES` | `1048576` | HTTP runtime body 和 WebSocket frame 上限 |
| `CYPHERIA_SERVER_HELLO_TIMEOUT_MS` | `10000` | WebSocket hello 截止时间 |
| `CYPHERIA_SERVER_RECONNECT_GRACE_MS` | `30000` | 传输断开后的逻辑 session 保留时间 |
| `CYPHERIA_SERVER_SHUTDOWN_TIMEOUT_MS` | `10000` | 优雅关闭截止时间 |
| `CYPHERIA_SERVER_WEB_ENABLED` | `true` | 内嵌 web 托管 |
| `CYPHERIA_SERVER_WEB_DIR` | 打包的 `dist/web` | 静态 web 根目录覆盖 |
| `CYPHERIA_SERVER_RELAY_ENABLED` | `false` | 是否启用 relay 连接 |
| `CYPHERIA_SERVER_RELAY_ENDPOINT` | 未设置 | Server 侧 relay endpoint |

可选 relay 发布和 TLS flag 的最终权威仍是配置 Schema 与代码。

## Agent 和 Server 日志

Server 向控制台和轮转文件写入结构化 JSON 日志。worker 写入 `logs/server.log`；supervisor 写入 `logs/server-supervisor.log`。`server.logging` 配置保存控制台及文件级别、可选文件路径和轮转限制。环境变量覆盖配置文件；持久化日志设置变更需要重启 Server。

Codex、Pi 和 ACP 进程生命周期记录包含 Agent ID、进程 ID、退出结果和 stderr 字节数。Codex 请求超时还会记录方法名。Server 会持续读取 Agent stderr，避免管道阻塞协议；原始内容可能含凭据或用户数据，因此不落盘。对话输出继续保存在规范 Timeline 中。

## HTTP 运维接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/health` | 进程存活 |
| `GET` | `/api/v1/ready` | Runtime 和 listener 就绪 |
| `GET` | `/api/v1/status` | Server 身份和状态 |
| `GET` | `/api/v1/state` | 实时运维状态 |
| `GET` | `/api/v1/diagnostics` | 进程、内存、连接和 runtime 诊断 |
| `GET` | `/api/v1/config` | 期望配置和重启状态 |
| `POST` | `/api/v1/config/patch` | 校验并原子保存 patch |
| `POST` | `/api/v1/config/reload` | 从磁盘重新加载配置 |
| `GET` | `/api/v1/relay/pairing-offer` | 经认证的 relay 配对 offer |
| `POST` | `/api/v1/runtime/request` | 经校验的特权 runtime 请求 |
| `POST` | `/api/v1/lifecycle/restart` | 受监管的 worker 重启 |
| `POST` | `/api/v1/lifecycle/shutdown` | 完整关闭 Server |

大多数产品操作使用 `/api/v1/ws`；REST 运维接口不会落入 SPA fallback。

## 认证与网络安全

默认只监听 loopback。未配置 Server token 时拒绝非 loopback 地址。HTTP 使用 Bearer header。浏览器 WebSocket 无法设置任意认证 header，因此通过协商的 Cypheria subprotocol 携带 token。

允许没有 `Origin` header 的原生客户端。浏览器连接默认仅允许同源；跨源访问需要显式 allowlist。Token 不通过 URL 传递，也不会编译进 Expo bundle。TLS 在 Node 进程之外终止。

## Sessions 与恢复

逻辑 session 以认证 principal 和 client ID 为键，可附加多个物理传输。Response 只返回源传输，状态广播发送给全部附着传输。最后一个传输断开时开始 reconnect grace；逻辑 session 不跨 worker 重启保存。

持久服务从 SQLite 恢复。可恢复 schedules 按 [Schedules](schedules.zh-CN.md) 所述进行 lease 和恢复。中断的 Web3 签名或发送操作绝不会自动重放。

## 内嵌 Web 应用

独立 Server build 会把 Expo 静态导出复制到 `apps/server/dist/web`。启用独立 web 托管时，Hono 先服务真实资产，再对客户端路由返回 `index.html`。HTML 不缓存；带指纹的资产使用 immutable cache。`/api/*` 始终是严格 API namespace。Desktop 会显式禁用由它启动的 Server 的 web 托管，因为 renderer 由 Electron（开发时由 Vite）提供，而不是由 Server 提供。

## 运维保证

- HTTP、WebSocket、配置和特权 runtime 输入都会经过校验。
- PID、身份、relay key、配置和 vault 文件拥有显式所有权与权限。
- 日志追加到 `$CYPHERIA_HOME/logs`，结构化状态响应不包含凭证。
- Diagnostics 暴露运维状态，不暴露私钥或秘密配置。
- 数据库、Agent、插件、Schedule、Terminal 和 Web3 生命周期会在优雅关闭期间收尾。
