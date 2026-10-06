---
title: Cypheria 文档
---

# Cypheria 文档

这些文档描述 Cypheria 的实现方式。每个主题由一份文档负责，其他文档通过链接引用，不重复其内容。英文为权威版本，每份文档都有完整的简体中文版本。

## 从这里开始

- [架构](architecture.zh-CN.md)：系统边界、进程归属、数据流与信任边界。
- [开发指南](development.zh-CN.md)：工具链、工作区、命令、生成产物、测试与文档规则。
- [路线图](roadmap.zh-CN.md)：已批准但尚未完成的工作。

## Server

- [Server 运行时](server/runtime.zh-CN.md)：进程监管、Cypheria home、配置、日志、HTTP 操作与认证。
- [协议](server/protocol.zh-CN.md)：transport、消息、Thread 与 Canonical Timeline、turn 与 interaction、客户端 SDK，以及 Computer Use host。
- [数据库](server/database.zh-CN.md)：SQLite schema、约束、事务与迁移策略。
- [Schedules](server/schedules.zh-CN.md)：cadence、lease、恢复，以及 Web3 不重放规则。
- [终端](server/terminals.zh-CN.md)：Thread 终端与认证终端、二进制流与限制。
- [Relay](server/relay.zh-CN.md)：加密远程传输、部署模式与容量。
- [AI 网关](server/ai-gateway.zh-CN.md)：基于 Cypheria 管理的 Agent 的 magpie 网关。

## Agent 与插件

- [Agent harnesses](agents/harnesses.zh-CN.md)：registry、安装、runtime，Codex、Claude、Pi、OpenCode 与 ACP harness，以及分支。
- [插件、Skills 与 MCP](agents/plugins.zh-CN.md)：集成模型、随附插件与 Cypheria app tools、marketplace、Codex Apps 与 hooks。
- [Polyglot Plugins](agents/polyglot-plugins.zh-CN.md)：Agent Plugins v1 布局、格式检测、原生支持与按 Agent 启用。
- [插件市场](agents/plugin-marketplaces.zh-CN.md)：市场分类、插件标识、本地存储、市场生命周期与数据库 Schema。
- [Agent 插件能力](agents/agent-plugin-capabilities.zh-CN.md)：各 Agent 的目录市场、原生格式与命令。
- [Plugin Extensions](agents/plugin-extensions.zh-CN.md)：插件依据 OpenAI MCP Extensions 提供的界面，以及 App 沙箱。
- [Codex 配置](agents/codex-config.zh-CN.md)：原生设置、项目信任、Thread 启动参数与 feature 开关。
- [Codex 权限](agents/codex-permissions.zh-CN.md)：权限模式及其与 Codex 的对应关系。
- [Codex App Server API](agents/codex-api.zh-CN.md)：供 adapter 开发使用的生成参考。

## Desktop

- [Desktop](desktop/desktop.zh-CN.md)：Electron 边界、Server Manager、Sidebar、设置、会话工作区与内置浏览器。
- [Composer](desktop/composer.zh-CN.md)：触发菜单、结构化引用、上传，以及输入如何到达 Agent。
- [客户端存储](desktop/client-storage.zh-CN.md)：设备本地的 key/value 状态、可重建 replica 与附件字节。

## 功能

- [Git](features/git.zh-CN.md)：Git 服务与协议、Review 面板、创建拉取请求与托管工作树。
- [代码审查](features/code-review.zh-CN.md)：代码审查 App、通过 OpenAI 后端的工具与私有审查。
- [Computer Use](features/computer-use.zh-CN.md)：Agent 操作浏览器、MCP App 与桌面应用所用的 `cua_repl` 运行时。
- [浏览器扩展](features/browser-extension.zh-CN.md)：用户浏览器背后的 Chromium 扩展与原生消息宿主。
- [Web3](features/web3.zh-CN.md)：网络、钱包、签名策略、dApp 会话与审计。

## 设计

- [UI 系统](design/ui-system.zh-CN.md)：视觉原则、主题、共享组件与回归不变量。
- [会话 UI](design/conversation-ui.zh-CN.md)：所有 Agent 共用的任务标题栏、Timeline、composer 与面板。
- [品牌](design/brand.zh-CN.md)：标志、颜色、图标与资源生成。

## 计划中

- [Cypheria Marketplace](planned/marketplace.zh-CN.md)：计划在官网内实现的提交、审核、发布与发现服务，目前尚未实现任何部分。

生成参考由其生成器更新，不手工编辑。
