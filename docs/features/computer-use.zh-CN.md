---
title: Computer Use
---

# Computer Use

Computer Use 让 Agent 替用户操作界面：Cypheria 内置浏览器的标签页、用户自己的 Chromium 浏览器、Desktop 窗口显示的 MCP App，以及原生桌面应用。Agent 通过同一个 MCP server `cua_repl` 访问这四类界面，其 JavaScript 运行时提供与 ChatGPT Computer Use 相同的 `cua` 和 `agent` 全局对象。本页负责说明该运行时、host、各界面及其信任边界；host 消息见 [Protocol](../server/protocol.zh-CN.md#computer-use-host)，内置浏览器本身见 [Desktop](../desktop/desktop.zh-CN.md#浏览器与-dapp-边界)。

## 运行时

`apps/cua`（`@cypheria/cua`）包含完整的 Computer Use 运行时：

| 部分 | 作用 |
| --- | --- |
| `src/launcher`（`dist/cua-repl.mjs`） | `cua_repl` MCP server：以导入运行时的 banner 启动 `node_repl`，并根据 `instructions/` 为已启用的界面、浏览器后端和当前平台组装工具描述 |
| `src/runtime`（`dist/runtime.mjs`） | REPL 沙箱中的 `cua` 和 `agent` 全局对象。它们组织调用，序列化 locator 链和 `evaluate` 函数，以 diff 形式呈现观察结果，在模型首次使用某种浏览器类型时展示 `docs/` 中对应的指南，在首次使用某项能力时展示该能力的指南，并在模型通过 `agent.documentation.get()` 请求时提供参考文档（故障排查、文件上传、本地开发、截图） |
| `src/browser` | 浏览器 API 语法：每个 `agent.browsers` 成员的参数 schema、是否改变状态，以及支持它的浏览器类型 |
| `src/engine` | 基于 `CdpTransport` 的页面引擎：带数字元素索引的无障碍状态、可信输入、基于引入的 Playwright injected script 的 Playwright locator、截图、对话框、文件选择器和日志 |
| `src/dom-engine` | MCP App 使用的仅基于 DOM 的引擎：通过 `evaluate` 函数执行 Playwright locator 和合成事件 |
| `src/host` | `CuaHost` 是 Server 侧：请求校验、界面与后端开关、Thread 范围、浏览器列举与路由，以及审计。`CuaDevice` 是 Desktop main 运行的设备侧：`chrome` 浏览器与原生应用后端 |
| `src/driver-host` | Desktop main 运行的内嵌 cua-driver daemon 监管器 |
| `plugin/` | 隐藏的 `cua` 插件模板 |

`cua_repl` 与 `node_repl` 是同一个二进制，只是通过 `NODE_REPL_JS_BANNER` 和 `NODE_REPL_TOOL_OVERRIDES` 换用了不同的 banner 和工具描述。Codex 把 `cua_repl` 和 `node_repl` 都视为 REPL 类 server。模型看到 `js` 和 `js_reset`。Server 会为每种 Agent 在 host 中直接结束每个 Thread 的 turn，因此 REPL 不参与 turn 结束。模型代码不受信任：REPL 运行在 Codex 沙箱和没有 `process`、文件系统或子进程访问的 V8 上下文中，只能通过 `nodeRepl.rpc("cua", request)` 访问 host，`node_repl` 再把请求转发给该 Thread 的 host services socket。所有决策都由 host 做出，运行时不做决策。

两个 server 的 kernel 以及 `cua_repl` 启动器都运行在 Cypheria 受管的 Node.js（`$CYPHERIA_HOME/toolchains/node`）上。在它安装之前，改用 Server 自身的可执行文件；由 Desktop 管理的 Server 运行在 Electron 上，因此这种回退会在 server 的环境中设置 `ELECTRON_RUN_AS_NODE=1`。Server worker 启动时会从自身环境中移除 `ELECTRON_RUN_AS_NODE`，因此 Agent、终端及其运行的命令都不会继承它。

## 插件

Server 依据 `apps/cua/plugin` 生成隐藏的 `cua` 插件，写入它在 `$CYPHERIA_HOME/marketplaces/cypheria-bundled` 下物化的 bundled marketplace，并填入本次安装的启动器。该插件声明 `cua_repl`，直接暴露 `js` 和 `js_reset`（`omit_tools_from: ["code_mode", "deferred"]`）。插件中的 server 保持禁用：每个 Codex Thread 启动时带有一个 `mcp_servers.cua_repl` 覆盖项，包含该 Thread 的 host socket、已启用的界面（`CUA_REPL_ENABLED_SURFACES`）和已启用的浏览器后端（`CUA_REPL_BROWSER_BACKENDS`）；Claude session 则通过 `CYPHERIA_CUA_HOST_PIPE`、`CYPHERIA_CUA_SURFACES` 和 `CYPHERIA_CUA_BROWSER_BACKENDS` 获得这些值，插件的 Claude 配置引用了这些变量。插件列表会隐藏 `cua`。

`browser`、`chrome` 和 `computer-use` 是只含 manifest 和图标的普通 bundled 插件：它们向用户和模型描述各个界面，并作为 composer 提及的锚点。它们的行为位于 `apps/cua`。

## Host

Thread 是共享的：每个客户端显示同一个 Thread，任何客户端都可以发送它的下一个 turn。Computer Use 操作的对象却不共享。标签页、App frame、浏览器和窗口都存在于某一台设备上，因此每个浏览器和应用都运行在已注册为 host 的 Cypheria Desktop 上，Server 只负责路由。Host 以 ChatGPT 的后端名称上报自己提供的能力。内置浏览器（`iab`）和 MCP App（`mcpapps`）属于窗口：每个 Desktop 窗口各自以这两个后端注册一个 browser host，因此各窗口的标签页和 App 互相独立。用户的 Chromium 浏览器（`chrome`）和原生应用（`computer`）属于设备：Electron main 通过自己的连接以这两项能力注册一个 computer host，并亲自执行这些请求，因此该 host 不依赖任何窗口是否打开。Electron main 和每个窗口都以 Desktop 在每个 Cypheria home 下只创建一次的 client ID 连接，因此 Server 把它们合并为一个 session。模型看到的是每台设备一个 host，以 client ID 命名，能力是其各窗口与设备能力的并集。Host 注册只存在于 Server 内存中，重启或重连后重新注册；标签页状态留在 Desktop，被查询时再次上报。其他客户端都不是 host。消息定义见 [Protocol](../server/protocol.zh-CN.md#computer-use-host)。

已存在的资源留在它所在的 host 上：内置浏览器标签页跟随拥有它的窗口，`chrome` 浏览器和应用窗口带有其 host，MCP App 则发给显示它的窗口。新的内置浏览器标签页或应用来自请求指定的 host；未指定时，来自发送该 Thread 当前 turn 的客户端（若它是 host）；再否则来自唯一提供它的 host。有多个候选且没有当前 host 时，请求会失败并列出设备，让模型指定一台或询问用户。`cua.hosts()` 列出已连接的 host 并标出当前 host。Thread 和 `cua_repl` 都不绑定设备；Thread 的 turn 结束或 Thread 关闭时，Server 会通知它用过的每台设备。

Server 的 `computerUse` 设置是用户针对所有设备的策略。设备只决定自己能提供什么以及如何提供，macOS 授权则属于持有它的 Desktop。

## 界面

`cua_repl` 采用 ChatGPT 的两个界面：`browser`，通过 `agent.browsers` 和 `cua.getBrowser()` 使用；`computer`，通过 `cua.getApp()` 使用。设置 → 通用 → 电脑操控 分别启用各部分，默认全部关闭（Server 配置中的 `computerUse`）。内置浏览器、你的浏览器和 MCP App 三个开关分别启用 `iab`、`chrome` 和 `mcpapps` 后端，任一开启即启用 `browser` 界面；“允许的浏览器”可以单独关闭某些浏览器家族（`blockedBrowserFamilies`），被关闭家族的浏览器既不会列出也无法访问。桌面应用开关启用 `computer`。被禁用的界面或后端不会出现在工具描述中，对它的调用会失败。

`agent.browsers.list()` 列出在各设备间唯一的浏览器 ID。`agent.browsers.get()` 和 `cua.getBrowser()` 也接受 `iab`、`mcpapps` 以及 `chrome`、`edge` 等浏览器家族名，在发送该 turn 的设备上解析。每个浏览器的类型就是它的后端，用于选择其指南和支持的 API 成员；所有浏览器共用同一套带数字元素索引的标签页 API：

| 浏览器 | 后端与类型 | 运行位置 |
| --- | --- | --- |
| 内置浏览器 | `iab` | Desktop 窗口；每个标签页的页面由 Electron main 中的引擎经 `webContents.debugger` 驱动 |
| 用户的浏览器 | `chrome` | 设备的 Electron main，由引擎驱动页面；见[外部浏览器](#外部浏览器) |
| MCP App | `mcpapps` | Desktop 窗口，以及 App 沙箱 frame 中仅基于 DOM 的引擎 |
| 桌面应用 | `computer` 界面 | 由设备的 Electron main 托管的 [cua-driver](https://cua.ai/docs/cua-driver)，或 macOS 上用户已安装的 ChatGPT 的 Computer Use 运行时；见[桌面应用](#桌面应用) |

`cua.getState()` 报告各 host、带有该 Thread 所控制标签页的浏览器，以及新请求将使用的 host 上正在运行的应用。当差异更短时，观察结果只显示自上次观察同一目标以来的变化。Agent 打开的标签页是临时的，除非标记为交付或交接，否则在 turn 结束时关闭；从用户那里认领的标签页会被释放并保持打开；之后的 turn 再次使用该浏览器时，标记会被清除。

### 内置浏览器

窗口负责标签页生命周期及其浏览器能力：`visibility` 打开或隐藏该 Thread 的浏览器面板，`viewport` 在重置前固定该 Thread 标签页的尺寸。页面成员在 Electron main 中执行，详见 [Desktop](../desktop/desktop.zh-CN.md#agent-操控)。composer 中对标签页的提及会投影为 `plugin://browser@cypheria-bundled?mention=tab-v1&source=iab&browserId=iab&tabId=…&title=…&url=…`，由 `cua.getTab({ mention })` 解析；若该标签页的标题或 URL 已变化则拒绝。

### 外部浏览器

`chrome` 后端覆盖 macOS、Windows 和 Linux 上的 Google Chrome、Microsoft Edge、Brave、Vivaldi、Opera 和 Chromium，且只限 host 所在的设备。设备如何驱动它们是它的实现类型，属于 Desktop 设置（设置 → 通用 → 电脑操控 → 浏览器连接方式，即该设备客户端存储中的 `chromeImplementationType`）：`extension` 表示 Cypheria 扩展及其原生宿主（默认值，见[浏览器扩展](browser-extension.zh-CN.md)），`cdp` 表示使用 Chrome DevTools Protocol。这一选择只存在于设备上的 `@cypheria/cua` 内部：设备上报 `chrome` 浏览器时不说明驱动方式，Server 和 `cua_repl` 以 `chrome` 类型列出它们，两种实现类型都通过共享引擎提供相同的 API。

使用 `extension` 时，每个安装了 Cypheria 扩展的浏览器配置都经原生宿主连接到 Electron main，并各自列为一个 `chrome` 浏览器，ID 为 `family:实例`。扩展负责列出标签页、管理分页分组，并转发 `chrome.debugger` 的 CDP；所有页面行为都在 Electron main 的共享引擎中执行。Agent 标签页在后台打开，并放入以会话命名的分页分组；`chrome` 这样的家族名表示最后连接的配置。

使用 `cdp` 时，设备连接用户正在运行的浏览器。它找到每个浏览器的默认用户数据目录，读取浏览器在开启远程调试时写入的 `DevToolsActivePort` 文件，确认该端口有响应，再让引擎直接连接该 CDP 端点；它还会探测 9222 和 9229 端口，以找到以 `--remote-debugging-port` 启动的浏览器。用户在浏览器的 `inspect/#remote-debugging` 页面开启远程调试，并在浏览器询问时批准连接；Cypheria 从不以调试参数重新启动浏览器，也不复制其配置，因此 Agent 使用的是用户真实的标签页和会话。

一条连接服务浏览器的所有配置。每个打开的配置是一个 browser context，各自列为一个 `chrome` 浏览器，ID 为 `family:配置目录`，名称取自浏览器在 `Local State` 中显示的名称；通过隐藏的 `chrome://version` target 把 context 对应到目录，`chrome` 这样的家族名表示最后使用的配置。用户在所有配置中打开的标签页都可以在 composer 中提及。

Thread 只能操作它打开的标签页，或从 `browser.user.openTabs()` 中认领的标签页。Agent 标签页在后台打开，引擎会模拟焦点，因此它们无需切到前台即可接收输入。哪个 Thread 控制哪个标签页保存在 Desktop 的客户端存储中，Desktop 重启后仍然保留，直到浏览器重启。Thread 控制的标签页会显示 Agent 指针，其请求带有 `x-browser-agent: Cypheria/<版本>`。模型等待的下载、它用 `locator.downloadMedia()` 保存的媒体，以及它用 `tab.content` 导出的内容（经 Google 导出接口获取的 Google 文档、表格或幻灯片，或取自播放器自身字幕的 YouTube 字幕稿），都保存到“下载”文件夹。CDP 没有分页分组，因此使用 `cdp` 时，模型提供的会话名称不会像扩展那样把标签页分组。上传仅限任务的工作目录。

### MCP App

MCP App 可以从许多地方打开：Thread Timeline 中的工具调用、对话旁的 App、插件的全局页面或设置布局。`mcpapps` 浏览器把调用方 Thread 可以操作的已打开 App 实例列为标签页：包括它自己的和不属于任何 Thread 的实例，但绝不包括其他 Thread 的实例；列表来自 Server 自己的实例表，只保留有 Desktop 窗口正在显示的实例。每个窗口都渲染自己的实例副本，因此操作会发给发送当前 turn 的设备上的副本（若它显示该 App），否则发给显示它的最新窗口。窗口记录每个已挂载 App 及其沙箱 origin，并带着该 origin 把调用发给 Electron main。main 只在发起请求的窗口内，把匹配沙箱代理的子 frame 识别为 App 文档，并在其中运行仅基于 DOM 的引擎：Playwright locator、`evaluate`、DOM 快照，以及以合成事件执行的点击、输入、按键、勾选和选择；这些都不使用 `eval`，因此 App 的内容安全策略不会阻止它们。截图从窗口中截取 App frame 所在的矩形区域。不支持原生输入、导航或坐标定位，App 关闭后其标签页随之失效。

### 桌面应用

`computer` 界面有两个后端，按设备在设置 → 通用 → 电脑操控 → 桌面应用控制中选择（即该设备客户端存储中的 `computerBackend`）：cua-driver 是所有平台上的默认值；ChatGPT Computer Use 是用户已安装的 ChatGPT 的运行时，仅限 macOS。Server 和 `cua_repl` 都看不到这一选择。

#### cua-driver

桌面应用使用 host 所在设备上的 cua-driver：它读取无障碍树和截图，并在后台用自己的光标叠加层执行操作，不移动用户的指针或焦点。`cua.getApp` 绑定一个窗口：在 macOS 上按名称、bundle ID 或路径，必要时在后台打开应用；在 Windows 和 Linux 上按窗口 ID。每个 Thread 使用自己的 cua-driver session。当 cua-driver 无法确认操作效果并建议换一种方式时，操作会返回提示。

Cypheria 以内嵌 daemon 的方式使用 cua-driver，而不是使用独立的 CuaDriver.app 或进程内 SDK：

- 在 macOS 上，辅助功能和屏幕录制授权属于进程的责任应用（responsible app）。Desktop main 直接 spawn 随附的 `cua-driver serve --embedded`，因此 driver 以 Cypheria 的授权运行，从不自行弹出授权提示，用户只需授权一个应用。若由 Server 启动，授权会归属到启动 Server 的进程。
- 独立的 daemon 保留了需要 driver 自身 UI run loop 的光标叠加层，并把 driver 故障与 Electron main 隔离。
- Desktop main 通过 `cua-driver mcp --embedded --socket` 连接它，端点为 `$CYPHERIA_HOME/run/cua-driver.sock`（路径过长时改用临时目录中的 socket；Windows 上为 named pipe），并执行 Server 路由到本设备的请求。Server 负责策略与审计，自己从不运行 driver。

Desktop 在设置中申请 macOS 授权，并在授权变化后重启 daemon（因为 macOS 会按进程缓存授权结果），然后重新注册 host。daemon 未运行时，Windows 和 Linux 直接运行 `cua-driver mcp`，macOS 则回退到已安装的、持有自身授权的 CuaDriver.app。Cypheria 关闭 cua-driver 的遥测和更新检查。`pnpm --filter @cypheria/cua fetch:cua-driver` 下载固定版本并校验摘要；Server 构建会把它复制到运行时旁的 `dist/cua/bin`，Desktop 从那里找到它。

#### ChatGPT Computer Use

Cypheria 从不附带、下载或修改 OpenAI 的组件；它原样运行用户安装的运行时，并保留其所有决定。Desktop main 从 ChatGPT 在用户开启 Computer Use 时写入的最新 `~/.codex/plugins/cache/openai-bundled/unified-computer-use/*/.mcp.json` 中读取 `mcpServers.cua_repl`，优先选择与 ChatGPT.app 版本一致的那份。它只做静态检查：该条目指向的文件存在；ChatGPT.app 和 Codex Computer Use.app 能以 OpenAI 的团队 `2DC432GLL2` 通过 `codesign --verify --strict`；为运行时提供沙箱的 Codex 具有 `sandbox` 子命令。是否兼容由运行时自己的握手决定。设置会显示该后端不可用的原因，例如从未在 ChatGPT 中开启 Computer Use。

运行时使用 ChatGPT 的命令和环境启动，只做以下改动：使用 Cypheria 的 Codex（`CODEX_CLI_PATH`，取自本设备的 Codex 安装回执；本设备没有时，例如连接远程 Server 时，改用 ChatGPT 自带的 Codex）和 Codex 主目录（`CODEX_HOME`，`NODE_REPL_TRUSTED_CODE_PATHS` 中也替换）；只服务原生应用（`CUA_REPL_ENABLED_SURFACES=computer`）；只加载 `sky` 服务并开启其录音方法（`SKY_ENABLE_AUDIO=1`），不带 ChatGPT 的浏览器后端和说明。与 Codex 为每个 thread 运行一组 MCP 连接一样，每个 Thread 有自己的运行时进程：在该 Thread 第一次请求原生应用时启动，在 Thread 关闭或空闲十分钟后停止。

Desktop main 是运行时的 MCP 客户端。每个请求都变成一次针对原始 `sky` API 的 `js` 调用（`list_apps`、`get_app_state`、`click`、`type_text`、`press_key`、`scroll`、`set_value`、`select_text`、`perform_secondary_action`、`paste`、`drag`），并在 `x-codex-turn-metadata` 中带上 Thread 和每个 turn 的 ID；截图以图像内容返回。运行时按名称或 bundle ID 绑定应用而不是按窗口，也没有菜单 API。Computer Use 第一次操作某个应用之前，运行时会请求批准；Cypheria 把它变成 Thread 中任何客户端都能回答的权限问题，在用户决定期间暂停设备请求的截止时间，运行时自己拒绝和禁止的应用仍然被拒绝。每个 turn 结束时，Desktop 调用运行时的 `turn_ended` 工具并运行 `SkyComputerUseClient turn-ended`。用户停止操作会作为停止报告给模型；服务拒绝运行时则会关闭该后端，并在设置中显示原因。辅助功能和屏幕录制权限属于 Codex Computer Use.app，由它自行请求。

#### 电脑音频

当 Server 的环境中有 `NODE_REPL_ENABLE_AUDIO=1` 时，REPL 会获得 `nodeRepl.emitAudio`，它把音频作为 MCP 音频内容返回给模型；`cua.computer` 也会多出 `start_audio_recording({ max_duration_ms })` 和 `stop_audio_recording()`，并随原生应用指南一起向模型说明。录制的是电脑播放的声音，不是麦克风。只有 ChatGPT Computer Use 能录音：`start_audio_recording` 对应 `sky` 的同名方法，其批准请求会变成 Thread 中 `kind: "audio"` 的权限问题；cua-driver 会拒绝这些请求。录音留在开始录音的设备上。`stop_audio_recording` 返回运行时保存的 WAV 文件的大小和类型，运行时再通过 `apps.audio.read` 以 384 KiB 为单位分段读回（低于 Server 的消息上限），最后返回一个可交给 `nodeRepl.emitAudio` 的 data URL。时长范围与 ChatGPT 相同，为 100 毫秒到五分钟。

## 安全

- 运行时文档要求模型把界面内容视为不可信，在执行有后果的操作前与用户确认，并把登录、验证码和钱包步骤交给用户。任何页面发起的钱包签名仍需通过 Server 策略，详见 [Web3](web3.zh-CN.md)。
- Server 用 Zod 校验每个请求，把它限定在其 socket 所属的 Thread，每次调用都检查界面和后端开关，按浏览器类型检查浏览器成员，把它路由到一个 host，并以 `cua.<operation>` 事件在审计日志中记录会改变状态的操作，不记录页面或应用内容。设备会再次校验发给它的请求；设备请求经由 Electron main 自己的连接到达，从不经过 renderer。
- 超时或失去 host 的状态变更命令会报告为“可能已执行”，从不自动重试。
- 不向模型开放完整的 CDP 访问，也不提供浏览历史、书签和常用网站。
- 外部浏览器和原生应用操控使用的是用户自己的会话和应用。它们的开关默认关闭；cua-driver 只在用户授予 Cypheria 的 macOS 权限范围内操作，ChatGPT Computer Use 在第一次操作每个应用之前会询问 Thread 中的用户。
