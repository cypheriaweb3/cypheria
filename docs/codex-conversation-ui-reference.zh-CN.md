---
title: Codex 会话 UI 参考
---

# Codex 会话 UI 参考

本文是 Cypheria 重现 Codex 任务会话体验的实现参考。它描述可观察到的结构和行为，不复制 ChatGPT 的实现代码。普通 ChatGPT 会话模式和应用级左侧导航不在本文范围内。

## 状态与证据

参考目标是 2026-09-20 检查的本地解包 ChatGPT Desktop `26.915.31945`（`build 9922`）。证据分为三种强度：

- **实机观察：**通过只读 CuaDriver 截图确认 Codex 任务窗口的可见比例、层级、扁平 activity row、双层浮动 composer、宽 Review 面板和独立标题栏开关。截图含用户数据，因此不会提交仓库。
- **源码确认：**解包后的 `local-conversation-page`、`local-conversation-thread`、`composer-host`、`composer-utility-bar`、`thread-app-shell-chrome`、`thread-scroll-layout`、`thread-side-panel-tab-content`、`right-panel-composer-overlay` 和后台终端 bundle 用于确认状态及交互。
- **Cypheria 映射：**可复用展示位于 `@cypheria/ui`；持久化、transport、runtime 与领域行为留在 Desktop 和 Server。

视觉估算值只作为默认值，不构成协议。44px 标题栏、原始 40rem 内容宽度、639px 紧凑断点和 70% 用户消息上限由源码确认。与 Cypheria 正式会话工作区比较后，共享实现改为 Timeline 与 composer 共用 48rem 外层宽度，使两侧边缘对齐；消息内部排版仍可独立维持可读性。

以下记录被检查 bundle 的身份，便于后续审计区分产品变化与解释变化：

| Bundle | SHA-256 |
| --- | --- |
| `local-conversation-page-112daed315f5.js` | `1bc90d93a4c74ab9bfb68134170b56c675a3c4c879716657dea1e6697279c4a9` |
| `local-conversation-thread-d531b243ea4e.js` | `014788e09176b4be847cec5f702225ce77851f98577525e80e846859b85008e7` |
| `composer-host-1069c79f77de.js` | `5293950f723dc480cbbc170896b6e5eedc89754c12bae06c84833129840c3639` |
| `composer-utility-bar-63b667abc11c.js` | `7b34b71202fe2d44d25fa6250ac2f0593f59bd86d2218a32fbf9ff3222283e4a` |
| `thread-app-shell-chrome-e7ab72062e15.js` | `7f4be251470eed08b5d855a21562772a346468f3e04c55cd43718dd985477d90` |
| `thread-scroll-layout-a1fd58afc6e8.js` | `982a991b8f970846725093623ea0bfc10c907934d1f69b197e17760638d9f03e` |
| `thread-side-panel-tab-content-2b3cd260bf24.js` | `57bceb291e63944d939c8bc4f19664330f8185edcb0b485e39f4025440017205` |
| `right-panel-composer-overlay-f770dcfd060a.js` | `c1def12dd32e4aea1be827b6c3b20e68e7657a02add4adcc52c690fc274e60c5` |
| `local-conversation-background-terminal-tab-6b15fb4e8083.js` | `cd39bbc8dc5b8f7333bc5ff1448cfc94ad87bd86cd2d94423ca6efef6b10fec7` |

## 产品边界

共享会话界面从任务标题栏开始，包含 Timeline、composer、可选右侧面板和可选底部面板。它必须在不克隆任何 harness 应用的情况下服务 Codex、Claude、Pi、OpenCode 和 ACP。

Shell 不拥有全局 Sidebar、路由选择、Thread 持久化、协议类型、网络请求、Agent 进程、终端进程或文件系统访问。Harness 专属 UI 只能出现在有清晰来源标识的 Timeline item、composer control 或 panel content 中。

## 空间模型

Shell 使用嵌套的双轴工作区。上方 workspace 将会话主列与右侧面板并列，且两者各自拥有顶部 chrome；底部面板则位于整个 workspace 下方。两个面板可以同时打开。调整面板尺寸不能替换 active tab、重置 composer 或丢失 Timeline anchor。右侧分割保留像素宽度，右侧面板最小为 320px，会话主列最小为 480px；会话达到该阈值后继续向左拖，会把会话折叠到零，使右侧面板占满上方 workspace，且不影响底部面板。Desktop 只从 1181px 宽屏断点开始挂载该分割，避免正常约束形成无法移动的布局。底部分割保留 160px 至 50% 的像素高度，并为上方 workspace 至少保留 240px；向下拖过 160px 阈值时会折叠到零，并把受控 visibility 切换为 `hidden`。尺寸持久化回调在指针或键盘交互结束后执行，而不是在每次指针移动时执行。按钮触发的面板与全屏转换对 resizable flex 布局执行 200ms 动画并遵循 reduced motion；直接指针拖动不添加动画。

Cypheria 默认布局 token 如下：

| Token | 默认值 | 用途 |
| --- | ---: | --- |
| `--chat-header-height` | `2.75rem` | 标题栏高度 |
| `--chat-fixed-header-actions-width` | `4.625rem` | 两个固定 panel toggle 的预留宽度 |
| `--chat-thread-max-width` | `48rem` | Timeline 与 composer 的共享宽度 |
| `--chat-content-max-width` | `var(--chat-thread-max-width)` | 消息阅读宽度 |
| `--chat-composer-max-width` | `var(--chat-thread-max-width)` | 浮动 composer 宽度 |
| `--chat-main-min-width` | `30rem` | 会话主列最小可调整宽度 |
| `--chat-right-panel-size` | `420px` | 右侧面板初始宽度 |
| `--chat-bottom-panel-size` | `280px` | 底部面板初始高度 |
| 底部面板最大值 | `50%` | 保留上方 workspace |
| 右侧面板全屏 | `100%` | 只替换上方会话区域 |

### 顶部标题栏

标题栏紧凑且克制。会话标题栏属于会话主列，内容是项目或 workspace 上下文，随后是可截断的任务标题；运行、思考和用量属于次级状态，不混入标题。右侧面板拥有独立但对齐的标题栏，其中放置 tabs、launcher 和 Enter/Exit full screen。Toggle bottom panel 与 Toggle side panel 组成固定在 workspace 最右侧的控制组；两个标题栏都会为该控制组预留宽度，相邻图标按钮统一使用 32px 按钮尺寸与 4px 间距，因此右侧面板隐藏时按钮位置与节奏都保持不变。此时会话标题栏自然向右扩展，其底部分隔线延伸到固定控制组下方；右侧面板可见时，其标题栏则刻意不显示底部分隔线。在 Desktop 中，会话标题栏复用正式工作区的 `desktop-titlebar` 标记与层叠契约：它会移除路由层 44px 的兜底留白，让收起状态的 Sidebar controls 保持在标题 surface 上方，并使左侧 padding 跟随左侧导航的展开/折叠状态一起动画。

面板与摘要控件是相互独立的 toggle，具有持久 pressed 状态和 accessible name。长标题应先截断，不能挤走操作控件。状态变化除颜色与动画外还必须提供文本或无障碍标签。

### 会话流

Timeline 是主滚动容器。内容居中限制在阅读宽度内，滚动条属于完整主列。用户消息是靠右的紧凑气泡，通常限制在阅读宽度的 70%，compact 形式限制在 456px。Assistant 内容不使用外框，并占用完整阅读宽度。

Timeline item 包括用户和 assistant 消息、reasoning、tool activity、command、plan、review summary、approval、file、生成 artifact、error 与 retry affordance。`ChatMessageContent`、`ChatReasoning` 与 `ChatTool` 自己拥有 transcript 专用排版和展开层级，不继承通用 AI Elements 的视觉层。`ChatActivityList` 与 `ChatActivityItem` 保持扁平的进度行；`ChatCommandBlock`、`ChatFileChanges`、`ChatFileChange` 和 `ChatTurnNotice` 为更丰富的 transcript item 提供可复用结构，但不嵌入 runtime 行为。消息操作在 hover 和键盘 focus 时出现。窄型 turn navigator 可以为用户 turn 提供跳转目标，但不应成为主导航模型。

可复用事件目录覆盖审计确认的全部 37 个 item discriminator。`ChatTimelineEvent` 提供通用 icon、tone、state、metadata 和 action 契约；plan/todo、approval、user-input、agent、generated-image、diff、resource、handoff、transcript 与 timestamp 组件则保留不能简化为通用行的独特视觉结构。开发 Demo 将它们分为 9 个可独立开关的家族，既能检查完整目录，又不会把所有 item 强行塞进默认 transcript。

旧历史在保留 anchor 的前提下从上方加载。流式更新复用稳定 item identity。动态 response spacer 在实时边缘保留空间，使 active response 不被 composer 遮挡。只有用户离开实时边缘时才显示 scroll-to-latest 控件。

### Composer

Composer 浮在 Timeline 上方，并与其外层使用同一 48rem 宽度。其 frame 包含可选 context tray、原生 `ChatComposerForm` 与多行 `ChatComposerTextarea`，以及紧凑 utility footer。附件、引用来源、权限模式、执行位置、workspace/worktree/base、模型、reasoning effort、听写与 send/stop 都通过可组合 control 表达，而不是嵌入业务逻辑。

Composer 清楚区分 ready、submitted、streaming 和 error 状态。Streaming 时主操作从 send 切换为 stop。Queue 和 steer 由应用层管理，但复用相同 tray 与 control。草稿、附件、selection 和 focus 在 Thread adoption 与面板变化时保持。

右侧 overlay 需要横向空间时，composer 可使用 `panel-overlay` 布局与调用方提供的 offset。隐藏 composer 会保留状态、设置 inert，并展示独立 reveal control。Reduced motion 取消布局动画，但不改变状态转换。

### 右侧面板

右侧面板是可调整尺寸的 tab host，而不是固定 Context inspector。Tab 可以动态启动、独立选中、在允许时关闭，或在允许时移动到底部面板。面板 header 负责 tab 导航、tab 局部操作和 launcher。

共享面板 chrome 对齐观察到的 app-shell tab strip，而不是通用下划线 tab bar：默认 36px pane toolbar 内放置紧凑的圆角 28px tab；作为 workspace 顶层 chrome 的右侧面板采用 44px 标题栏高度，底部 toolbar 则保持 36px。Tab strip 可横向滚动但隐藏 scrollbar，尾部操作组固定不滚动。长标题在尾部逐渐变淡，不使用生硬的截断边界；关闭按钮紧邻淡出区域。Active tab 始终显示关闭操作，inactive tab 在 hover 或键盘 focus 时显示关闭操作。Inactive tab 之间使用短分隔线维持分组，不给内容区增加卡片边框。Side launcher 紧跟 side tabs；bottom launcher 紧跟 bottom tabs，底部 toolbar 右侧只保留 Close。

Bundle 确认的 tab 与 host 包括 Sources、Subagents、Plan、Summary、Goal、Review/diff、pull request、Terminal、文本文件、图片、cloud browser、MCP App、automation、通用 artifact、PDF、DOCX、notebook、presentation、workbook 和 entity detail。每个 tab 拥有自己的滚动区域及 empty、loading、error、read-only、disconnected 和超大内容状态。打开 tab 不能改变 Thread 或 Timeline 滚动位置。

### 底部面板

底部面板与右侧面板使用同一套 tab descriptor 和生命周期。Terminal 是最常见的一方内容，但这个位置不只属于 terminal：review、browser 或 artifact tab 也可以移动到这里。Tab strip 固定在 active content 上方，终端 session 保留标题和 running/exited/failed 状态。

底部工具栏复用同一套 tab 机制，并使用略微弱化的 surface，使两种 panel placement 同时打开时分割关系仍然清楚。右侧与底部分割线使用 1px 可见线条和扩大的指针命中区，提供明确的 hover/focus 反馈、原生 separator 语义和方向键 resize。

隐藏面板会保留 tab 与 active value。关闭 tab 会移除该 tab。关闭最后一个 tab 后，应用层可以将面板转换为 `closed`；UI 包只发出相应 callback。

## 交互与状态模型

### 面板生命周期

Panel 有三个明确展示状态：

- `visible`：参与布局和交互。
- `hidden`：保留 registry 与 active tab，但处于 hidden、inert 和 `aria-hidden` 状态。
- `closed`：panel component 不挂载。

Hidden panel 仍留在原来的 collapsible resizable panel 中，只把尺寸收缩为零。恢复显示时，同一个 panel instance 按调用方保存的像素尺寸展开，因此 tab 内容、renderer 局部状态与 focus bookkeeping 不会仅因隐藏而重挂载。Closed panel 才会离开 resizable tree。应用层拥有 tab array、placement、active value、持久化尺寸、launcher 可用性，以及空面板是否关闭的决定。共享层只发出 active-tab、close-tab、move-tab、visibility 和 resize 事件。

### 滚动与流式输出

Desktop 拥有 virtualizer 和每 Thread scroll controller。展示层提供 scroll container、内容宽度、state row、spacer、navigator 和 live-edge affordance，不假设固定 item height。首次导航及显式 turn/latest 导航使用立即定位；挂载时不会先落在估算出的中间 offset，也不执行 smooth-scroll 动画。可变高度 row 完成测量前，可以重复执行同一个立即到底部的对齐动作。

加载历史、展开 reasoning、terminal output、大型 diff 和流式 tool result 必须保留用户的视觉 anchor。只有用户原本就在实时边缘时才自动跟随新输出。Cancel、retry、pending interaction 和 failure recovery 在操作发生处展示。

### Focus、键盘与无障碍

Base UI 提供 tab roving focus 和 menu 行为。每个纯图标操作都需要 accessible name 与 tooltip。Tab selection、current turn、expanded、disabled 和 panel toggle 使用原生 ARIA 语义。隐藏 panel 和 composer 设置 inert，避免其后代获得键盘 focus。

打开面板不应从 composer 抢走 focus，除非用户明确触发了移动 focus 的操作。关闭或移动当前聚焦 tab 时，focus 返回稳定的相邻 tab 或 panel launcher。状态使用文本和 live-region 语义，不能只靠颜色。

### 响应式行为、动效与本地化

在 639px 及以下，内容与 composer 宽度变为流式，非必要 control label 可以收起为 icon 与 tooltip。应用层应先隐藏或 overlay 次要面板，而不是把主列压缩到不可用宽度。较长的英文和简体中文标签不能挤走核心 send/stop 操作。

所有动效遵循共享 reduced-motion 偏好。明暗主题使用 semantic surface、border、foreground、muted、destructive、success 与 focus token。组件不嵌入产品文案；Desktop 通过 Lingui 提供本地化可见文本和 accessible label。

## 面板内容分类

Sources 对 attached、read、created、updated、web、tool-input 与 tool-result 内容分组。Subagents 对 active 和 completed 工作分组，并显示状态、model 与 reasoning effort。Plan、Summary 与 Goal 使用轻量 section 和 step primitive。Review 组合 scope control、pull-request card、文件统计、文件选择和与 renderer 无关的 diff host；pull-request detail 还覆盖 check、reviewer、comment 与错误恢复。Terminal 组合 tab selection、生命周期状态和与 renderer 无关的 output host。

文件、图片、browser preview、MCP App、automation、通用 artifact、PDF、DOCX、notebook、presentation、workbook、entity detail、side chat、MCP thread/file extension、sandbox 与 secondary timeline 使用构建在 `ChatPreviewPanel`、`ChatPreviewToolbar`、`ChatPreviewHost` 和 `ChatPreviewStatusBar` 之上的具名 `ChatPanelSurface` wrapper。Wrapper 暴露稳定的 `data-kind` 标识，共享 section、list、empty/error state 与 launcher 仍可组合。这些 host 只定义结构；editor、annotation engine、browser session、sandboxed app、document renderer、kernel、Office bridge 与领域 store 仍由应用层拥有。

## Cypheria 组件映射

| Codex 能力 | 共享组件界面 | 应用层拥有的行为 |
| --- | --- | --- |
| 任务 chrome | `ChatWorkspaceShell` 固定标题操作、会话 `ChatHeader`、面板 `ChatPanelHeader`、title/status/actions/toggles、`ChatPinnedSummary` | project lookup、标题修改、分享、用量数据、Desktop sidebar 状态 |
| 双轴 shell | `ChatWorkspaceShell`、`ChatPanelLayout`、resize handle | 保存的尺寸、开关状态、右侧全屏状态 |
| Timeline | Timeline item、message content、reasoning/tool disclosure、activity list/item、command block、file changes、notice、navigator、spacer、live-edge button | Canonical Timeline 映射、virtualization、anchor 持久化 |
| Composer | dock/frame/form/textarea/tray/utility control/submit/reveal | 草稿、附件、权限、model catalog、send/stop/queue |
| 动态面板 | `ChatPanel`、tab、launcher、section、list 与状态 primitive | registry、可用性、持久化、tab placement |
| Sources 与 subagents | source/subagent group 与 row | runtime event 与导航 |
| Plan 与 summary | plan step 与 summary section | plan data、用量与摘要 |
| Review | PR card、toolbar、file list、diff host | Git 状态、diff 加载、review command |
| Terminal | terminal tab、status 与 output host | process 生命周期、xterm controller、审计 |
| 通用预览 | preview panel/toolbar/host/status bar | 文件 editor、图片/PDF/DOCX/notebook/Office renderer、browser/MCP session |

### Desktop 接入

正式会话页接入 chrome 时不需要复制 Demo 的 utility class。把现有 Timeline 与 composer 组合进 `ChatWorkspaceShell`；只在右侧面板缺席时为会话 `ChatHeader` 传入 `reserveFixedActions`；为右侧 `ChatPanel` 传入 `workspaceHeader`；再把 bottom/side toggle 放进 `fixedHeaderActions`。只有 Desktop 添加 `desktop-titlebar` class，因为动态左侧留白及其层叠关系属于应用 Sidebar。现有应用状态继续拥有 visibility、active tab、尺寸、fullscreen、resize 持久化与 panel content。

## 所有权边界

`@cypheria/ui` 包含 React 展示、semantic styling、chat 自有的 message/composer/tool primitive、Base UI 交互 primitive、直接 Streamdown 渲染和 renderer slot。Chat component surface 不依赖 AI Elements，因此其间距与交互层级可以独立贴近审计后的 Codex 体验。它不导入 `@cypheria/protocol`，也不导入 Desktop、Electron、Server、router、query 或 IPC module。

Desktop 将 Canonical Timeline 和 harness data 映射为 component props，拥有每 Thread 草稿与滚动状态，挂载 virtualizer 与 diff/terminal renderer，并持久化 panel layout。Server 保留 Agent runtime、repository、terminal、policy、特权操作和 audit。

共享 icons 目录完整镜像固定版本的 OpenAI Apps SDK UI 图标源，共 755 个 MIT 许可组件，并记录上游 revision 与本地仅无障碍相关的修改。Cypheria 不复制解包 ChatGPT 应用中的任何代码。

## 对齐优先级与验收

### P0 发布门槛

- 稳定的标题栏、Timeline、浮动 composer，以及右侧与底部面板同时打开的布局。
- 每 Thread 草稿与滚动位置保持、稳定流式 identity，以及不强制滚动离开用户阅读 anchor。
- Send、stop、pending、failure、retry、hide、close、move 和 resize 语义具备键盘与指针对等性。
- 正确 focus、accessible name、`aria-*`、inert hidden surface 与明暗主题对比度。

### P1 完整工作界面

- Sources、Subagents、Plan、Summary、Review、PR、Diff 和 Terminal 的展示状态。
- 增量历史、大型 diff、展开 reasoning、terminal output、长翻译和紧凑窗口行为。
- Harness attribution 不分叉公共 conversation shell。

### P2 细节完善

- 精确 easing、延迟 hover action、细微 shadow、scrollbar 强度以及 panel/composer transition timing。
- 不改变共享状态模型的额外通用 artifact launcher 与更丰富 tab preview。

验收要求所有受支持 Agent 行为等价、既有 Desktop 会话无回退，并且共享 UI 包不含特权或协议依赖。
