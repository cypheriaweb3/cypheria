# Agent 管理

Cypheria protocol v2 要求所有 ACP traffic 在与 `protocolVersion`、`type` 同层的位置携带 `agent`。其值是已提交的 `AgentId`：原生 `codex`、`claude`、`pi`、`opencode`，以及生成的静态 union。生成器只临时下载 ACP Registry，并仅提交 `src/generated/acp/agent-ids.ts`；Registry JSON 不是 protocol 构建产物。与 native 支持对应的 Registry ID（`codex-acp`、`claude-acp`、`pi-acp`、`opencode`）会被排除。V2 batch 的外层与所有内层 agent ID 必须一致。WebSocket subprotocol 为 `cypheria.v2`。

`@cypheria/client` 通过 `api.agent.manager` 暴露 registry、安装、更新、卸载、enable/disable、start/stop、operation 与 toolchain API。安装、更新、卸载和工具链更新都是异步 operation，并通过 progress 与终态 notification 报告。Enable 明确独立于安装：新安装成功后仍为 disabled，disabled agent 不得启动，也不得接收业务协议调用。

Server 在启动时及之后每小时刷新 ACP Registry，使用 ETag 与 Last-Modified 条件请求、20 秒超时、4 MiB 大小限制、与上游 `agent.schema.json` 对齐的校验，并原子保存到 `$CYPHERIA_HOME/agents/registry.json`；validator 保存在同目录。`codex-acp`、`claude-acp`、`pi-acp`、`opencode` 等 Registry 条目描述的是 ACP 包装器或发行物，不能作为 Cypheria native agent 的元数据。Native 元数据根据各 agent 的官方项目和文档维护在 server catalog 中。SQLite `agent_registry` 记录选定或已安装 agent 版本的元数据：ID、name、version、description、repository、website、icon、native、installed、enabled 与更新时间。安装或更新会同时提交具体安装和这些元数据；卸载会将 `installed` 设为 false 并禁用 agent，但保留其 version 和元数据。因此 `AgentView.version` 始终非空，由 `installed` 独立表示该版本是否已实际安装。下载的 Registry 始终代表 ACP agent 的上游最新状态，并通过 `AgentView.availableVersion` 暴露候选版本；客户端按照语义化版本优先级派生是否可更新，不再传输冗余布尔值。`integrity` 表示当前二进制制品是否经过 SHA-256 校验；包管理器安装或没有 receipt 的 agent 返回 `not-applicable`。由于此前没有发布过 Cypheria 数据库版本，数据库迁移已合并为一个 baseline。

## 受管运行环境

Cypheria 不会把 agent 安装到用户全局 Node、Python、npm、uv 或 package 目录。它会在 `$CYPHERIA_HOME` 下 bootstrap 最新稳定 Node LTS、uv 和受管的非 prerelease CPython。缺失工具链会自动 bootstrap；之后升级必须通过显式协议调用。多个版本并存且原子切换，因此运行中的进程继续使用启动时选择的绝对路径。

```txt
$CYPHERIA_HOME/
  toolchains/
    node/versions/<version>/
    python/versions/<version>/
    uv/versions/<version>/
    python-envs/<fingerprint>/
    current.json
    manifest.json
    staging/
  cache/
    toolchains/
    npm/
    corepack/
    uv/
  agents/
    registry.json
    registry.metadata.json
    <agent-id>/
      versions/
      home/
      staging/
      receipts/
```

Registry distribution 按经过校验的平台 binary、npm package、Python package 的顺序选择。npm package 在安装阶段物化，运行时直接执行本地 entry point，不隐式联网。Python package 先由 uv 解析为带 hash 的完整传递 lock。共享不可变环境的 fingerprint 包含该 lock、index、OS、架构、完整 CPython build/ABI 与 uv 版本。相同依赖闭包只保存一份，不兼容闭包保持隔离。运行进程持有 lease；mark-and-sweep GC 会保留所有被已安装 receipt 或 lease 引用的环境。需要修改 site-packages 的 agent 使用专用 fingerprint。

Native compatibility unit 精确固定为：Codex `0.153.4`、Claude CLI `2.1.274` 与 Claude Agent SDK `0.3.270`、Pi `0.85.1`，以及 OpenCode Registry binary `1.18.30` 与 SDK `1.18.31`。Codex 和 OpenCode 是 server 共享进程；Claude、Pi 与 ACP agent 按 Cypheria 逻辑 session 隔离。OpenCode 在随机 loopback port 上运行，暴露稳定 SDK root 和两条 event stream，并拒绝实验性 `/v2` endpoint。

共享依赖环境通过 uv cache 与同文件系统链接避免意外依赖冲突并减少物理占用。它不是针对恶意本地代码的安全 sandbox；敌对代码隔离需要后续 process sandbox 或 container boundary。
