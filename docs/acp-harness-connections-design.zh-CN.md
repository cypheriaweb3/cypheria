# ACP Agent Harness Connections 设计

状态：提案

调研时间：2026-09-06
范围：Desktop 中的 Grok Build、Cursor、Gemini CLI、Hermes Agent 与 OpenCode

## 核心决策

Codex 保持现有专用 App Server 集成并始终启动。其余 harness 统一通过 ACP v1 client 和惰性进程 supervisor 接入。

- 首次安装总是解析并安装当时的最新版本。Cypheria 记录实际版本用于展示和追溯，但不保存版本约束。
- Installed、Enabled、Running、Authenticated/Configured 是相互独立的状态。
- Enable 仅使 harness 可选，不启动进程；选择使用时才启动 ACP，disable 后停止并禁止新任务。
- binary、runtime、cache、配置、credential 与 session 全部放在 `$CYPHERIA_HOME/harnesses/<id>` 下。
- 能检测时显示已安装版本；只有上游存在可靠检查机制时才显示“有新版本”提示，更新由用户点击触发。
- Connections 页面内容区域底部提供页面级、多标签的应用内 PTY terminal；可以同时打开多个 agent terminal，切换 connection 时保留，离开 Connections route 时统一关闭。只接入有官方本地服务文档的 Web UI：OpenCode Web 与可选的 Hermes Web Dashboard。

官方 [ACP Registry](https://github.com/agentclientprotocol/registry) 只作为分发元数据，不能当作可直接执行的远程 catalog。Cypheria 内置审核过的 descriptor，限定 publisher、package、host、command、环境变量与 latest 解析策略。当前 registry 有 Grok Build、Cursor、Gemini CLI 和 OpenCode；Hermes 需要 Cypheria 自己维护 descriptor。

## ACP 与架构

ACP v1 是基于 stdio 的 newline-delimited JSON-RPC。连接先调用 `initialize` 协商 capability 与 authentication methods，再使用 `session/new`、`session/load` 或 `session/resume`。权威规范见 [Initialization](https://agentclientprotocol.com/protocol/v1/initialization)、[Authentication](https://agentclientprotocol.com/protocol/v1/authentication)、[Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup)。使用官方 [`@agentclientprotocol/sdk`](https://github.com/agentclientprotocol/typescript-sdk) 的 stable v1，并拒绝不兼容的 major version。

```text
renderer -> typed harness.* IPC
Electron main
  -> HarnessConnectionService
     -> HarnessCatalog
     -> HarnessInstaller / HarnessUpdateService
     -> HarnessSupervisor
     -> HarnessTerminalService
     -> HarnessWebUiService
  -> @cypheria/acp-bridge -> ACP stdio child
```

`packages/acp-bridge` 不依赖 Electron，负责 ACP transport、initialize、request correlation、cancel、timeout、event projection 与 AI SDK adapter。安装、进程/PTY/Web server 生命周期、keychain 和 IPC 均归 Electron main。ACP 本身不是 sandbox，workspace、approval 和 signing policy 仍由 Cypheria 执行。

Descriptor 描述行为，不固定发行版本：

```ts
type HarnessDescriptor = {
  id: HarnessId
  protocol: { major: 1; transport: "stdio" }
  latestResolver: LatestResolver
  installer: ManagedInstaller
  executable: string
  serveArgs: readonly string[]
  versionProbe: readonly string[]
  updateCheck: UpdateCheckStrategy
  updateAction: UpdateAction
  homeEnv: Readonly<Record<string, ManagedPath>>
  terminalPresets: readonly TerminalPreset[]
  localWebUi?: LocalWebUiDescriptor
}
```

不能执行网络返回的任意命令。远端 metadata 必须经 Zod 校验和内置 allowlist 约束；spawn 只能使用 app-managed absolute executable 与 argv array。

## Managed 安装与 Home

```text
$CYPHERIA_HOME/
  harnesses/
    state.json
    <id>/
      runtime/       # 当前 binary/package payload
      home/          # vendor home
      os-home/       # 必要时使用的 synthetic HOME
      staging/       # 事务式安装/更新
  cache/harness-downloads/
  logs/harnesses/<id>/
```

这些路径由 `CypheriaRuntimePaths` 一次解析并注入 service。Managed harness 绝不能静默 fallback 到用户 `PATH` 上的同名程序。

| Harness | Managed home 映射 |
| --- | --- |
| Grok Build | `GROK_HOME=<...>/home`、`GROK_BIN_DIR=<...>/runtime/bin`，同时使用 synthetic `HOME`；其 installer 仍会经 `$HOME/.grok` 写 download、completion 和 installer config |
| Cursor | synthetic `HOME=<...>/os-home`；官方 installer 硬编码 `$HOME/.local/share/cursor-agent` 与 `$HOME/.local/bin`，CLI config 使用 `~/.cursor` |
| Gemini CLI | `GEMINI_CLI_HOME=<...>/home`；npm prefix 为 `<...>/runtime` |
| Hermes | `HERMES_HOME=<...>/home`、`HERMES_INSTALL_DIR=<...>/runtime/hermes-agent`，并使用 synthetic `HOME` 容纳 `$HOME/.local/bin` launcher |
| OpenCode | synthetic `HOME`，以及 managed `XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`XDG_CACHE_HOME`、`OPENCODE_CONFIG_DIR` |

ACP、login/setup、update check、update、设置 terminal 和 Web UI 必须复用完全相同的 environment builder，避免用户在 terminal 完成的配置被写入 ACP 看不到的另一个目录。

Synthetic `HOME` 会有意隔离用户真实 dotfiles。保留 project cwd、`SSH_AUTH_SOCK` 与 proxy env；以后如需复用配置，应做显式 import/select，而不是默认读取真实 home。

### 永远安装最新版本

只有用户点击 Install 或 Update 时才解析 latest。不要持久化 desired version 或 range；只保存不可变 receipt：实际 version/commit、source URL、可用的 integrity、安装时间与 descriptor revision。

先装到 `staging`，校验 integrity/executable，执行 version probe，在限时内完成 ACP `initialize`，然后原子切换 active runtime。可以暂留一个旧 payload 用于安装失败恢复，但这不是用户可选的 version pin/rollback 功能。

- **Grok：** 在 managed `HOME`、`GROK_HOME`、`GROK_BIN_DIR` 下运行官方 latest-stable installer；必要时 fallback 到 allowlisted `@xai-official/grok@latest`。
- **Cursor：** 在 synthetic `HOME` 下运行官方 installer。
- **Gemini：** 在 app-owned npm prefix 安装 `@google/gemini-cli@latest`，直接运行 `node_modules/.bin/gemini`，ACP 启动时绝不运行 `npx @latest`。
- **Hermes：** 只运行官方 CLI installer，详见下文。
- **OpenCode：** 优先下载 ACP Registry 中带 SHA-256 的 platform artifact；否则在 synthetic `HOME` 下运行官方 installer，并加 `--no-modify-path`。

强制 HTTPS、下载大小限制、安全解压和上游已发布的 integrity 检查。Cursor 当前官方 installer 与 ACP descriptor 没有文档化的 artifact checksum，应在 diagnostics 显示这项限制，不能自己伪造可信 digest。安装不得请求管理员权限。

## 版本与更新矩阵

| Harness | 已安装版本 | 更新信息 | 产品行为 |
| --- | --- | --- | --- |
| Grok | `grok version`，fallback `--version` | 官方只读 `grok update --check` | 显示 update badge；点击后通过 managed installer 安装最新版本 |
| Cursor | `cursor-agent --version` | 官方只描述自动更新及 `update`/`upgrade`，未提供稳定的 check-only 命令/manifest | 显示版本和“Cursor 自行检查更新”；总是提供“更新到最新”；不伪造新版 badge |
| Gemini | `gemini --version` | 比较官方 npm package `@google/gemini-cli` 的 `latest` dist-tag | Managed profile 设置 `general.enableAutoUpdate=false`；显示 badge，点击后重新安装 `@latest` |
| Hermes | `hermes --version` | 官方只读 `hermes update --check` | 显示 badge；在 PTY 执行 `hermes update`，因为 dependency/config migration 可能需要用户处理 |
| OpenCode | `opencode --version` | 比较官方 GitHub latest release 或安装器采用的 ACP Registry version | 设置 `OPENCODE_DISABLE_AUTOUPDATE=true`；显示 badge，点击安装最新 verified artifact |

应用启动后最多检查一次；用户可手动 refresh；之后采用保守 cache interval（例如 24 小时）。需要 jitter、timeout，并遵守 proxy/offline 状态；保存 source 与 `lastCheckedAt`。检查失败表示 Unknown，不能当作 Up to date。

用户点击更新后：阻止新 turn，优雅停止 ACP，以可见进度执行更新，重新校验 version 与 ACP，最终回到 `enabled-idle`。若需要交互式 migration，展开 PTY 并预填命令。

## Enable/disable 与生命周期

```text
not-installed -> installing -> installed-disabled
installed-disabled -> enabled-idle
enabled-idle -> starting -> running -> auth-required | ready | failed
running -> stopping -> enabled-idle -> installed-disabled
```

- Codex 不进入此状态机并始终启动。
- Install 不等于 enable，enable 不等于 running。
- 用户选择 harness 或重新打开其 task 时才启动 ACP。
- Disable 阻止新 turn 并停止 ACP/本地 Web UI。有 active turn 时默认“本轮后 disable”，另提供“立即停止”。
- 打开的配置 terminal 可能有未完成交互，disable 时需单独确认是否关闭。
- 只有 task 正在等待时才做有限次数的 crash restart。
- 未验证跨进程 session recovery 前，不做 idle shutdown。

## 认证、应用内 Terminal 与 Web UI

ACP `initialize` 后按实际返回的 `authMethods` 渲染 UI。Agent-managed method 调 ACP `authenticate`；terminal method 用同一个 managed environment/cwd 启动独立真 PTY，完成后重连 ACP。OpenCode 仍需要时继续支持 legacy terminal-auth `_meta`。

通用 ACP 没有 Codex `account/read` 的等价能力。只有 session 创建成功后才显示 Verified。Harness token 留在 managed home；用户在 Cypheria 输入的 API key 放 OS credential store，只在 child spawn 时注入。

每个非 Codex connection 详情页都有 **打开终端**，但 terminal dock 属于整个 Connections route：它在内容区域底部展开、支持多个 agent tab；切换左侧 connection 不关闭 tab，离开 Connections route 时由 cleanup IPC 统一关闭。Electron main 持有 PTY，只暴露 typed input/output/resize/close/close-all IPC。Shell 的 `PATH` 首项为 managed runtime，应用 managed home env，以所选 workspace 为 cwd，并先打印：

```text
Cypheria managed <Harness> terminal
Home: <managed path>
这里的修改只影响 Cypheria 管理的该 harness。
常用命令：<vendor presets>
```

Command chip 只把命令插入 PTY，不绕过 CLI。默认不持久化 scrollback，diagnostics 必须脱敏。

只有官方文档化本地 server 时才显示 Web UI：

- OpenCode：`opencode web --hostname 127.0.0.1 --port <allocated>`，设置应用随机生成的 `OPENCODE_SERVER_PASSWORD`。
- Hermes：先由用户显式安装同一 venv 的 `.[web,pty]` optional component，再启动 `hermes dashboard --host 127.0.0.1 --port <allocated> --no-open`。
- Grok 的 `grok dashboard` 只被文档化为打开 Agent Dashboard，不是我们管理的本地 server，因此只作为 external dashboard link。
- Cursor 与 Gemini CLI 未发现官方本地配置 Web UI。

本地页面在 Cypheria 内置 browser 打开。只能绑定 loopback，动态分配端口，校验 readiness 与 URL，并在关闭、disable 或 app exit 时停止 owned server。

## 各 Harness 细节

### Grok Build

- ACP：`grok agent stdio`。
- 登录：`grok login`、device flow `grok login --device-auth` 或 `XAI_API_KEY`；登出 `grok logout`。
- Terminal preset：`grok login`、`grok inspect`、`grok mcp list`、`grok setup`。
- 更新：`grok update --check`，用户点击后安装 latest stable。

权威资料：[概览/安装](https://docs.x.ai/build/overview)、[CLI](https://docs.x.ai/build/cli/reference)、[Settings/`GROK_HOME`](https://docs.x.ai/build/settings)、[installer](https://x.ai/cli/install.sh)。

### Cursor

- ACP：`cursor-agent acp`。
- 官方路径基于 HOME，因此 installer 与 CLI 都在 synthetic `HOME` 下运行。
- 优先使用 ACP 返回的 `cursor_login`；terminal fallback 为 `cursor-agent login`。API 方式为 `CURSOR_API_KEY`/`--api-key`、`CURSOR_AUTH_TOKEN`/`--auth-token`；状态/登出为 `cursor-agent status/logout`。
- 用 `cursor-agent --version` 显示版本。官方文档说明默认自动更新，也支持手动 `update`/`upgrade`，但未找到官方 check-only 机制。

权威资料：[ACP](https://cursor.com/docs/cli/acp)、[安装/更新](https://docs.cursor.com/en/cli/installation)、[认证](https://docs.cursor.com/en/cli/reference/authentication)、[installer](https://cursor.com/install)。

### Gemini CLI

- ACP：`gemini --acp`。
- App prefix 安装 `@google/gemini-cli@latest`，并设置 `GEMINI_CLI_HOME`。
- 登录：Google browser login、`GEMINI_API_KEY` 或 Vertex AI/ADC；按 ACP 实际 methods 处理，不硬编码 ID。
- Terminal preset：`gemini`、`gemini mcp`、`gemini extensions`；TUI 内可用 `/auth`。

权威资料：[安装](https://geminicli.com/docs/get-started/installation/)、[认证](https://geminicli.com/docs/get-started/authentication/)、[ACP](https://geminicli.com/docs/cli/acp-mode/)、[配置/`GEMINI_CLI_HOME`](https://geminicli.com/docs/reference/configuration/)、[版本/更新 FAQ](https://geminicli.com/docs/faq/)。

### Hermes Agent

这里指 Nous Research Hermes Agent。

- 只安装 CLI。绝不使用 Hermes Desktop installer，也不传 `--include-desktop`。
- 根据 2026-09-06 获取的官方 installation 文档与 installer source，未传 override 的 per-user 安装布局是：code 在 `~/.hermes/hermes-agent`，data 在 `~/.hermes`，launcher 在 `~/.local/bin/hermes`。这是对当前上游实现的快照，不能作为永久假设。
- 虽然 installer 支持 `--dir`/`HERMES_INSTALL_DIR` 和 `--hermes-home`/`HERMES_HOME`，launcher 仍跟随 `$HOME/.local/bin`；所以还必须设置 synthetic `HOME`。
- 基础安装：官方 latest installer 加 `--skip-setup --skip-browser --skip-computer-use --non-interactive --dir <runtime>/hermes-agent --hermes-home <home>`。它跟随最新 `main`，不安装 Desktop/大型可选工具，也不强制官方登录。
- 每次安装/更新都生成 receipt：记录 installer URL/标识、argv、受管理环境变量、platform/architecture、检测版本、最终 executable 与 SHA-256，以及安装前后新增/变化的文件清单（relative path、size、mtime）。Receipt 保存在 `$CYPHERIA_HOME/harnesses/hermes/receipts/`，用于事后审视；不记录 secret value。
- ACP：`hermes acp`。Provider setup 是可选的；用户可通过 `hermes model`、`hermes setup` 或设置 terminal 配置 Nous/第三方 provider。Enable 不能要求 Nous Portal 登录。
- 更新：`hermes update --check`；真实更新用交互式 `hermes update`。
- Web Dashboard 是 optional component：仅在用户请求时安装 `.[web,pty]`。这不是 Hermes Desktop。

权威资料：[安装/默认布局](https://hermes-agent.nousresearch.com/docs/getting-started/installation)、[installer flags](https://hermes-agent.nousresearch.com/install.sh)、[ACP](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp)、[providers](https://hermes-agent.nousresearch.com/docs/integrations/providers/)、[更新](https://hermes-agent.nousresearch.com/docs/getting-started/updating)、[环境变量](https://hermes-agent.nousresearch.com/docs/reference/environment-variables)、[Web Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)。

### OpenCode

- ACP：`opencode acp`。
- 使用最新 verified registry artifact；synthetic HOME/XDG 隔离所有 state。
- 在 PTY 使用 `opencode auth login` 配置 provider，使用 `auth list/logout` 查看/删除。
- 关闭原生 auto-update，由用户点击安装最新 verified release。
- 本地 Web UI：loopback-only `opencode web`，并生成 Basic Auth credential。

权威资料：[CLI/ACP/upgrade/env](https://opencode.ai/docs/cli/)、[providers](https://opencode.ai/docs/providers)、[config](https://opencode.ai/docs/config)、[Web](https://opencode.ai/docs/web/)、[server security](https://opencode.ai/docs/server/)、[registry descriptor](https://raw.githubusercontent.com/agentclientprotocol/registry/main/opencode/agent.json)。

## Renderer、IPC 与验收

```ts
type HarnessConnectionView = {
  id: HarnessId
  installedVersion: string | null
  availableVersion: string | null
  versionCheck: "supported" | "native-auto" | "unsupported"
  lastUpdateCheckAt: string | null
  installState: "notInstalled" | "installing" | "installed" | "updating" | "failed"
  enabled: boolean
  runtimeState: "disabled" | "idle" | "starting" | "running" | "stopping" | "failed"
  authState: "unknown" | "required" | "configured" | "verified"
  terminalAvailable: true
  localWebUi: "unsupported" | "componentMissing" | "stopped" | "starting" | "running" | "failed"
}
```

IPC 覆盖 list/install/update/uninstall/check、enable/lifecycle/auth、PTY create/input/resize/close，以及 Web UI component/start/stop/open。每个 mutation 返回 operation ID。设置页顺序：安装/版本、更新、enable/runtime、auth/provider、terminal、Web UI、storage、diagnostics、uninstall。Codex 显示 “Built in · Always on”。

验收要求：五个 harness 可独立安装 latest、经 ACP 使用、disable、更新和卸载；所有 owned file 都在 `$CYPHERIA_HOME`，测试证明真实 home 未改变；version/update 状态遵循上表；disabled process 全部退出；terminal 使用完全相同的 managed env；OpenCode/Hermes Web UI 只绑定 loopback 且可可靠清理；Hermes 不安装 Desktop、不强制 Nous 登录；secret 不进入 renderer persistence 或普通日志。

按独立、可 review 的 todo 实现：paths/state/descriptors；ACP bridge；lazy supervisor/task binding；PTY；逐个 installer（OpenCode、Gemini、Grok、Cursor、Hermes）；update UI；local Web UI；可靠性与平台测试。
