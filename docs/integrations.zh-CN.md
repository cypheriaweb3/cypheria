---
title: Integrations
---

# Integrations

> 计划中：Cypheria 原生插件执行尚未完成。

Server 通过统一 integration facade 展示 Skills、MCP servers、plugins、marketplaces 和 Codex Apps，同时保留各 harness 的来源和语义。

## 通用模型

每个 integration view 都包含所属 Agent 和可选原生 identifier。Compatibility tags 声明对 `codex`、`claude`、`pi`、`opencode` 或 ACP 兼容桶的支持。Server 在启用或启动前校验兼容性；客户端展示兼容、不兼容和 Agent 专属状态。

Harness records 会被归一化用于展示，但 mutation 仍路由回所属 Agent adapter。Cypheria 不会声称某个生态支持另一个生态的安装或信任模型。

## Skills

Skill 是可复用 instruction bundle。API 报告展示 metadata、scope、path、dependency count、enablement、harness、plugin membership 和 compatibility。在内容与 harness 支持允许时，Skill 被视为跨 Agent 概念；仅适用于某 Agent 的 Skill 携带对应 compatibility tag。

文件系统发现与启用由 Server 负责。客户端不直接扫描 harness home。

## MCP

MCP server 也是通用概念。Integration API 报告 tools、resources、authentication state、runtime state、enablement、plugin membership 和 compatibility，支持列表、添加 URL server、修改 enablement，以及启动 harness 支持的登录流程。

传输凭证和 OAuth 状态留在 Server 或 harness runtime。MCP elicitation 进入通用 Thread interaction 生命周期。

## 插件生态

`ecosystem` 标识插件契约：

- `cypheria`：Cypheria 原生 manifest 与 contribution points；
- `openai`：ChatGPT/Codex plugin format；
- `claude`：Claude plugin ecosystem；
- `pi`：Pi extensions；
- `opencode`：OpenCode plugins。

Plugin view 保留 source type、marketplace identity、install policy、availability、version、capabilities、compatibility 和 harness provenance。Harness 支持时，通过 harness adapter 实现列表、详情、安装、卸载和启用操作。

启用 Codex 插件时，Server 会注册随程序分发的 `cypheria-bundled` marketplace，并在 Cypheria 管理的 Codex home 中安装 `cypheria-app-tools`。这是一个 Codex MCP 插件，其本地 Git 工具通过经过认证的本地 HTTP 路由调用与 Desktop 相同的 Server Git 服务。它不声明 OpenAI App ID，也不持有 GitHub 或 GitLab connector 凭据。

Cypheria 原生插件使用独立契约。目标 manifest 声明 Server entry points、Desktop UI contributions、可选的未来 Expo contributions、permissions、兼容 Cypheria 版本和 contribution points。Server 代码必须运行在受控子进程中。Desktop contribution 必须沙箱化，并只获得受限 host API，而不是 Node.js、文件系统、数据库或密钥权限。完成该 runtime 与 UX 仍是计划工作。

## Marketplace 来源

Marketplace source 与 plugin ecosystem 是独立字段。Source kind 为 `cypheria`、`openai`、`claude`、`pi`、`opencode` 和 `custom`。自定义 marketplace 仍必须声明其中每个 plugin 的 ecosystem。

当前 integration facade 支持 harness 自己的 marketplace list、add、upgrade 和 remove 操作。它保留 marketplace name 和 path，避免把不同来源的同名插件合并为一个身份。

独立的公开 Cypheria Marketplace 服务仍在计划中，见 [Marketplace](marketplace.zh-CN.md)。它尚不存在，不影响 harness-native 或 custom marketplace 支持。

## Codex Apps

Apps 遵循 OpenAI App Server/connector 模型，只属于 Codex harness 扩展。它们通过 `client.harnesses.codex.apps` 暴露，包括 list、enablement、connect、callable/accessibility state、install URL 和 plugin association。

Desktop 在系统浏览器中打开 App 安装页面。窗口重新获得焦点后，会刷新 App 和 MCP 的可用状态；外部页面不会向本地发送可信的完成回调。

Apps 不会被改名为通用 Agent 功能。如果其他 harness 未来提供类似能力，应获得自己的 harness extension 与术语。

## 缓存与刷新

Server 可以缓存 harness list；协议允许时，调用方可请求刷新。Mutation 会使相关 harness 和 integration views 失效。客户端使用返回的权威 view，而不是猜测 harness 原生操作的结果。

## 安全规则

- 校验 manifests、identifiers、URLs、marketplace locations 和 compatibility metadata。
- 在存储和 UI 中保留 ecosystem、marketplace source 和 harness provenance。
- 原生 plugin contribution 必须声明明确 permissions。
- 不向 renderer extension 暴露 harness credential 或 host filesystem。
- 把远程 description、icon、prompt、tool 和 plugin code 视为不可信内容。
- 安装与执行留在 Server；客户端只请求受限操作。
