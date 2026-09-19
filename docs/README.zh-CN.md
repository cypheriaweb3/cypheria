# Cypheria 文档

> 状态：当前实现文档索引

本索引为每个主题指定唯一文档。其他文档应链接到权威说明，而不是复制内容。

## 从这里开始

- [架构](architecture.zh-CN.md)：系统边界、所有权、数据流与信任边界。
- [开发](development.zh-CN.md)：技术栈、工作区、命令、生成、测试与贡献流程。
- [当前路线图](todo.zh-CN.md)：只记录计划中的工作。

## Runtime 与协议

- [Server](server.zh-CN.md)：进程监管、配置、运行目录与运维。
- [Client/Server 协议](protocol.zh-CN.md)：transport、消息、领域操作、Timeline 与错误。
- [Agents](agents.zh-CN.md)：registry、安装、runtime 模型、第一方 adapter 与 ACP。
- [数据库](database.zh-CN.md)：当前 SQLite 基线与迁移策略。
- [Schedules](schedules.zh-CN.md)：cadence、lease、执行、恢复与非重放保证。
- [Relay](relay.zh-CN.md)：加密远程 transport、部署、容量与可观测性。

## 产品界面

- [Desktop](desktop.zh-CN.md)：Electron 边界、Server Manager、Sidebar、会话工作台与本地设置。
- [Integrations](integrations.zh-CN.md)：Skills、MCP、plugins、marketplace 来源与 Codex Apps。
- [Web3](web3.zh-CN.md)：network、wallet、policy、签名、dApp 与审计。
- [UI 系统](ui.zh-CN.md)：视觉原则、主题实现、AI Elements 与回归不变量。
- [品牌](brand.zh-CN.md)：产品标志、颜色、图标与资产生成。

## Provider 参考

- [生成的 Codex App Server API](codex-app-server-api.zh-CN.md)
- [Codex 配置语义](codex-app-server-config.zh-CN.md)
- [Cypheria 中的 Codex 权限](codex-permissions.zh-CN.md)

## 计划中的服务

- [Cypheria Marketplace](marketplace.zh-CN.md)：计划中的远程提交、审核、发布与发现服务；当前尚无对应应用。

每份维护中的英文产品文档都有 `.zh-CN.md` companion。生成参考必须通过 generator 更新，不能直接编辑。
