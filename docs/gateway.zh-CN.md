---
title: AI 网关
---

# AI 网关

AI 网关为 Cypheria 管理的 Agent 提供一个本地端点，统一接入所有模型提供方与订阅，并支持路由组和用量统计。Server 以受监管子进程的方式运行 [magpie](https://github.com/cypheriaweb3/magpie)（Cypheria 构建的 magpie）来提供网关。客户端只能通过[协议](protocol.zh-CN.md)的 `magpie` 能力访问它；magpie 自身的 API 始终位于 Server 之后。

## 版本与安装

`@cypheria/protocol` 在 `src/generated/magpie/release.json` 中固定一个 magpie 版本，并记录其各平台终端构建的 SHA-256。该版本的 OpenAPI 文档提交在同一目录，Zod schema 由此文档生成：

```sh
pnpm --filter @cypheria/protocol generate:magpie-zod
```

该命令会先获取固定版本 tag 的 OpenAPI 文档再生成。`check:magpie-zod` 在 protocol 包构建、测试或类型检查前运行，生成的 schema 过期时会失败。

首次开启网关时，Server 从 `cypheriaweb3/magpie-releases` 的对应版本下载 `magpie-cli` 构建，校验 SHA-256 后安装为 `$CYPHERIA_HOME/toolchains/magpie/<version>/magpie`。与固定校验值不符的下载会被拒绝。在此模式下，magpie 从不自动更新、不发送使用统计、不安装 Agent 的 CLI，也不运行插件。

## 生命周期

网关默认关闭，需在 Desktop 的网关设置中开启。开启后 Server 启动它、随 Server 一同启动，并在它退出时重启（每分钟最多五次）。关闭即停止。开关与端口保存在 `$CYPHERIA_HOME/gateway/cypheria.json`。

Server 启动 `magpie web` 时设置：

- `MAGPIE_HOME=$CYPHERIA_HOME/gateway`，存放 magpie 的全部设置、提供方、登录、用量与缓存；
- `MAGPIE_AGENTS_FILE=$CYPHERIA_HOME/gateway/agents.json`，使 magpie 进入 Cypheria 对接模式；
- 网关监听 `127.0.0.1` 的网关端口（默认 3445），magpie 的 API 监听 `127.0.0.1` 的 API 端口（默认 3446），并使用每次启动生成的密钥保护。

端口从不使用独立 magpie 的默认端口 3425 和 3430，因此用户自己的 magpie 可以与 Cypheria 的同时运行。启动前，Server 会通过 `$CYPHERIA_HOME/gateway/magpie.pid` 及其可执行文件识别并结束此前 Server 遗留的 magpie。若端口仍被占用，Server 改用下一个空闲端口并保存；magpie 就绪后，凡设置仍指向旧网关的 Agent 都会被重新接入。magpie 的输出写入 `$CYPHERIA_HOME/logs/magpie.log`。

## Agent

Agent 描述文件按 magpie 的 id（`antigravity-acp` 为 `agy`、`github-copilot-cli` 为 `copilot`、`grok-build` 为 `grok`）列出每个已安装且已启用的 Agent，内容与 Cypheria 启动它的方式一致：

- 命令，以及位于 CLI 自身子命令之前的参数，不含启动其 ACP 或 app-server 模式的参数；
- 工作目录；
- 在 Server 环境之外额外传给它的变量：toolchain 的 `PATH` 与其隔离目录，例如 `CODEX_HOME`、`CLAUDE_CONFIG_DIR` 或它自己的 XDG 目录。

Server 在网关启动时、以及 Agent 被安装、移除、启用或停用时写入该文件；文件变化后 magpie 会重新读取。因此 magpie 在 Agent 的 Cypheria 目录中修改其设置、指令、MCP 服务器与技能并读取其会话，而非用户自己的目录。它不认识其他 Agent，也不会改动用户自己的 Agent。

## 订阅与提供方

magpie 只登录、列出并提供所列 Agent 的订阅：Claude、Codex、Copilot、Cursor、Devin、Gemini、Antigravity 与 Grok。它在 Agent 保存登录的位置读写登录信息，因此 Agent 与网关共享同一登录；某账户额度用尽时，magpie 可能把 Agent 切换到其另一个账户。使用密钥的提供方不受限制。

## 客户端

`magpie` 能力提供：

- 网关的状态、版本、端口与错误；安装 magpie、开启或关闭网关、重启；
- 所列 Agent 及其 magpie 字段、设置字段、将 Agent 重新接入网关；
- 提供方、路由组，以及按时段的用量。

`magpie.status.changed.notification` 报告每次状态变化。网关未就绪时，读取 magpie 数据的请求会以 `MAGPIE_NOT_RUNNING` 失败。
