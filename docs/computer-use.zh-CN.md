---
title: Computer Use
---

# Computer Use

Computer Use 让 Agent 替用户操作界面：Cypheria 内置浏览器的标签页、用户自己的 Chromium 浏览器、Desktop 窗口显示的 MCP App，以及原生桌面应用。Agent 通过同一个 MCP server `cua_repl` 访问这四类界面，其 JavaScript 运行时提供 `cua` API。本页负责说明该运行时、各界面及其信任边界；浏览器 host 消息见 [Protocol](protocol.zh-CN.md#浏览器-host-与-computer-use)，内置浏览器本身见 [Desktop](desktop.zh-CN.md#浏览器与-dapp-边界)。

## 运行时

`apps/cua`（`@cypheria/cua`）包含完整的 Computer Use 运行时：

| 部分 | 作用 |
| --- | --- |
| `src/launcher`（`dist/cua-repl.mjs`） | `cua_repl` MCP server：以导入 `cua` 运行时的 banner 启动 `node_repl`，并根据 `instructions/` 为已启用的界面和当前平台组装工具描述 |
| `src/runtime`（`dist/runtime.mjs`） | REPL 沙箱中的 `cua` 全局对象。它组织调用、以 diff 形式呈现观察结果，并在模型首次进入某个界面时展示 `docs/` 中对应的指南 |
| `src/host` | 特权侧，供 Server 使用：请求校验、界面开关、Thread 范围、审计，以及外部浏览器与原生应用后端 |
| `src/driver-host` | Desktop main 运行的内嵌 cua-driver daemon 监管器 |
| `plugin/` | 隐藏的 `cua` 插件模板 |

`cua_repl` 与 `node_repl` 是同一个二进制，只是通过 `NODE_REPL_JS_BANNER` 和 `NODE_REPL_TOOL_OVERRIDES` 换用了不同的 banner 和工具描述。Codex 把 `cua_repl` 和 `node_repl` 都视为 REPL 类 server。模型看到 `js` 和 `js_reset`；隐藏的 `turn_ended` 工具供 hook 调用。模型代码不受信任：REPL 运行在 Codex 沙箱和没有 `process`、文件系统或子进程访问的 V8 上下文中，只能通过 `nodeRepl.rpc("cua", request)` 访问 host，`node_repl` 再把请求转发给该 Thread 的 host services socket。所有决策都由 host 做出，运行时不做决策。

## 插件

Server 依据 `apps/cua/plugin` 生成隐藏的 `cua` 插件，写入它在 `$CYPHERIA_HOME/plugins/cypheria-bundled` 下物化的 bundled marketplace，并填入本次安装的启动器。该插件声明 `cua_repl`，直接暴露 `js`、`js_reset` 和 `turn_ended`（`omit_tools_from: ["code_mode", "deferred"]`），并带有调用 `turn_ended` 的 Codex `Stop`、`Interrupt` 和 `SubagentStop` hook。插件中的 server 保持禁用：每个 Codex Thread 启动时带有一个 `mcp_servers.cua_repl` 覆盖项，包含该 Thread 的 host socket 和已启用的界面；Claude session 则通过 `CYPHERIA_CUA_HOST_PIPE` 和 `CYPHERIA_CUA_SURFACES` 获得这些值，插件的 Claude 配置引用了这两个变量。插件列表会隐藏 `cua`。

`browser`、`chrome` 和 `computer-use` 是只含 manifest 和图标的普通 bundled 插件：它们向用户和模型描述各个界面，并作为 composer 提及的锚点。它们的行为位于 `apps/cua`。

## 界面

设置 → 通用 → 电脑操控 分别启用每个界面，默认全部关闭（Server 配置中的 `computerUse`）。被禁用的界面不会出现在工具描述中，其 API 会抛出错误。由于元素模型和能力不同，每个界面都有自己的 API：

| 界面 | API | 后端 | 元素 |
| --- | --- | --- | --- |
| 内置浏览器 | `cua.iab` | 经由 Server broker 的 Desktop 浏览器 host | 来自无障碍快照的 `@eN` ref，CDP 可信输入 |
| 外部浏览器 | `cua.browsers` | 通过 CDP 连接用户浏览器的 [agent-browser](https://github.com/vercel-labs/agent-browser) | 来自 agent-browser 快照的 `@eN` ref |
| MCP App | `cua.mcpApps` | Desktop main，在 App 的沙箱 frame 内执行 | `@eN` ref，仅限合成 DOM 事件 |
| 桌面应用 | `cua.getApp` | [cua-driver](https://cua.ai/docs/cua-driver) | 数字索引，映射到最新窗口快照的 element token |

`cua.getState()` 返回所有已启用界面的清单。当差异更短时，观察结果只显示与同一目标上一次观察相比的变化。

### 内置浏览器

`cua.iab` 通过 [Protocol](protocol.zh-CN.md#浏览器-host-与-computer-use) 所述的浏览器 host 操作该 Thread 的内置浏览器标签页。composer 中对标签页的提及会被投影为 `plugin://browser@cypheria-bundled?mention=tab-v1&tabId=…&title=…&url=…`，`cua.iab.getTab({ mention })` 会解析它，并在标签页标题或 URL 已变化时拒绝。Agent 打开的标签页是临时的，除非标记为 deliverable 或 handoff，否则会在 turn 结束时关闭。

### 外部浏览器

`cua.browsers` 在 macOS、Windows 和 Linux 上支持 Google Chrome、Microsoft Edge、Brave、Vivaldi、Opera 和 Chromium。host 找到每个浏览器的默认用户数据目录，读取浏览器在开启远程调试期间写入的 `DevToolsActivePort` 文件，确认端口可连接，然后以该端点的 `--cdp` 运行 agent-browser，每个 Thread 和浏览器各用一个 session。用户在浏览器的 `inspect/#remote-debugging` 页面开启远程调试，并在浏览器询问时允许连接；Cypheria 从不带调试参数重启浏览器，也不复制其配置文件，因此 Agent 使用的是用户真实的标签页和登录状态。

Thread 只能在自己打开（`newTab`）或从浏览器当前标签页列表中认领（`claimTab`）的标签页中操作。turn 结束时，未标记的自建标签页会关闭，未标记的认领标签页会被释放并保持打开。已标记的标签页保留；当之后的 turn 再次使用该浏览器时，其标记会被清除。agent-browser 在 session 切换标签页时会重新编号 ref，因此切换后失败的操作会提示需要先为该标签页重新快照。上传只限于任务的工作目录。

### MCP App

`cua.mcpApps` 列出 Desktop 窗口为调用方 Thread 挂载的 MCP App，并通过其 DOM 操作它们。renderer 记录每个已挂载 App 及其沙箱 origin；`list_mcp_apps` 和 `mcp_app` host 命令会发给 renderer，renderer 再携带该 origin 把操作转发给 Electron main。main 只在发出请求的窗口内，把匹配的沙箱代理的子 frame 视为 App 文档，用内置浏览器的快照引擎生成快照，并以合成事件执行点击、输入、按键、选择、勾选和滚动。截图从窗口中截取 App frame 所在的矩形。没有原生输入、导航或坐标定位；App 关闭后其句柄失效。

### 桌面应用

桌面应用使用 cua-driver：它读取无障碍树和截图，并在后台用自己的光标叠加层执行操作，不移动用户的指针或焦点。`cua.getApp` 绑定一个窗口：在 macOS 上按名称、bundle ID 或路径，必要时在后台打开应用；在 Windows 和 Linux 上按窗口 ID。每个 Thread 使用自己的 cua-driver session。当 cua-driver 无法确认操作效果并建议换一种方式时，操作会返回提示。

Cypheria 以内嵌 daemon 的方式使用 cua-driver，而不是使用独立的 CuaDriver.app 或进程内 SDK：

- 在 macOS 上，辅助功能和屏幕录制授权属于进程的责任应用（responsible app）。Desktop main 直接 spawn 随附的 `cua-driver serve --embedded`，因此 driver 以 Cypheria 的授权运行，从不自行弹出授权提示，用户只需授权一个应用。若由 Server 启动，授权会归属到启动 Server 的进程。
- 独立的 daemon 保留了需要 driver 自身 UI run loop 的光标叠加层，并把 driver 故障与 Electron main 隔离。
- 负责策略与审计的 Server 通过 `cua-driver mcp --embedded --socket` 连接到双方从 Cypheria home 推导出的端点（`$CYPHERIA_HOME/run/cua-driver.sock`；路径过长时改用临时目录中的 socket；Windows 上为 named pipe）。

Desktop 在设置中申请 macOS 授权，并在授权变化后重启 daemon，因为 macOS 会按进程缓存授权结果。没有 Desktop 时，Windows 和 Linux 直接运行 `cua-driver mcp`，macOS 则回退到已安装的、持有自身授权的 CuaDriver.app。Cypheria 关闭 cua-driver 的遥测和更新检查。`pnpm --filter @cypheria/cua fetch:cua-driver` 下载固定版本并校验摘要；Server 构建会把它和当前平台的 agent-browser 二进制复制到 `dist/cua/bin`。

## 安全

- 运行时文档要求模型把界面内容视为不可信，在执行有后果的操作前与用户确认，并把登录、验证码和钱包步骤交给用户。任何页面发起的钱包签名仍需通过 Server 策略，详见 [Web3](web3.zh-CN.md)。
- host 用 Zod 校验每个请求，把它限定在其 socket 所属的 Thread，每次调用都检查界面开关，并以 `cua.<operation>` 事件在审计日志中记录会改变状态的操作，不记录页面或应用内容。
- 外部浏览器和原生应用操控使用的是用户自己的会话和应用。它们的开关默认关闭，cua-driver 只在用户授予 Cypheria 的 macOS 权限范围内操作。
