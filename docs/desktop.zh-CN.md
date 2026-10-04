---
title: Desktop
---

# Desktop

`apps/desktop` 是 Cypheria 的主客户端，由 Electron main、preload 与 TanStack Start renderer 组成，保留紧凑、面向工作区的 Sidebar 和会话体验。它不与 Expo 共享应用 shell。

## 进程边界

- Electron main 负责窗口、应用生命周期、Server 管理、桌面设置、安全存储、更新、原生菜单、操作系统集成，以及浏览器 guest 加固：webview 挂载、浏览器配置、弹窗、导航、自动化和 dApp provider 边界。
- File → New Window（`CmdOrCtrl+Shift+N`）打开另一个与第一个窗口布局相同的窗口。每个窗口都以 Desktop 唯一的 client ID 作为 Server 的完整客户端，Server 只把窗口当作内存中的连接，重连或重启后由窗口重新注册。主窗口（每次启动的第一个窗口）跨启动保存 Thread panel 布局、接收深链接，在 macOS 上关闭时隐藏；其他窗口只在内存中保留布局，关闭即销毁。
- Preload 为 Electron 专属能力暴露狭窄的类型化 IPC。
- TanStack renderer 直接通过 `@cypheria/client` 使用共享产品状态并消费实时 Agent turns。
- 浏览器标签页是由窗口 renderer 承载的沙箱化 `<webview>` guest。Electron main 为每个 guest 选择 preload；dApp preload 只向安全 origin 的顶层 frame 暴露受限 provider bridge，绝不暴露 Node.js 或密钥材料。

浏览器 guest 和弹窗始终关闭 `nodeIntegration`，开启 `contextIsolation`、sandbox 和 web security。

## Server Manager

启动时，Electron main：

1. 检查配置或打包的 Server executable；
2. 发现正在运行的本地实例并校验协议兼容性；
3. 没有可复用实例时启动 Server；
4. 等待 readiness 后再连接 renderer；
5. 保存可操作的日志与失败状态；
6. 只在空闲且安全时回收由当前 Desktop 启动的进程。

打包应用会把 Server distribution 复制到 resources。Desktop 不会把数据库、Agent、Schedule、Integration 或 Web3 所有权移回 Electron。

## Sidebar 不变量

Sidebar 使用 Cypheria Projects、Threads、Sections facades。Server 直接返回 membership 和排序；renderer 不从 Codex metadata 推断它们。

Renderer 将 Projects、Sections、Project memberships 和 Section memberships 保存在 eager TanStack DB Query Collections 中；活跃 Thread collection 使用 on-demand 同步。Live queries 从这些规范化资源派生 Sidebar 视图，Server notifications 则通过 direct writes 应用跨窗口和外部变更。move、reorder、pin 与 unpin 等领域动作继续使用显式 Cypheria RPC，因为它们会原子更新多个有序资源。查询取消会传递给共享 client 的 request signal；重连或 mutation 恢复可以重新获取全部 Sidebar collections，而无需恢复定时轮询。

既有交互模型是产品不变量：

- Pinned、自定义 Sections、Projects 和 recents 保持层级与视觉密度。
- Project Threads 保持嵌套，并支持展开、分页和“显示更多”。
- 协议允许时，选择、创建、重命名、归档、删除、固定、取消固定、拖放、跨 Section 移动和排序保持可用。

Project 编辑器展示有序 workspace roots 模板，第一项是 Project 的主要目录。保存只会修改 Project，现有 Threads 保留各自的 roots。Thread Summary 会列出 workspace directories、标识当前工作目录，在 Thread 空闲时静默应用安全的 additive Project roots，并为其他差异提供 **Sync to project workspace directories**。确认框会醒目标出 cwd 变化，并分别列出新增与移除 roots。Sidebar 菜单与拖放移动会在改变 Project membership 前使用相同警告。活动 turn 或缺少所需 cwd/root capability 的 Agent 会禁用这些修改。

Pinned 与自定义 Sections 按 Server 定义的混合顺序渲染，因此 Projects 与独立 Threads 保持交错。Sidebar 拖放使用 dnd-kit，并为 Sections、Projects、Project Threads 和 Section 混合条目发送对应的 `before...` 位置提示。Priority 排序依次考虑未读、需要关注、运行中和最近更新的 Threads。Thread 行无需打开会话即可显示运行、失败和停止状态。
- 上下文菜单、键盘导航、未读状态和运行状态保持可见。
- 加载、空、错误和乐观状态保持布局，失败 mutation 会回滚。

Query key 和乐观更新基于 Cypheria ID。Harness session ID 不会替代 Thread ID 成为导航或缓存身份。

## 页面标题栏

Desktop 不会在所有路由上方全局预留标题栏。需要共享窗口 chrome 的路由自行渲染 `PageHeader` 并传入自己的子组件；不需要标题栏的路由则从内容区顶部开始填充。`PageHeader` 负责标准的 44px 几何尺寸、Electron 拖拽区域，以及让页面内容与 Sidebar 展开/折叠标题栏控件联动的左侧 inset 动画。

会话工作区有意不使用 `PageHeader`。它的 chrome 按 Chat Demo 参考拆分为会话 `ChatHeader` 与右侧 `ChatPanel` workspace header。会话标题栏参与同一套 Sidebar inset 过渡；右侧标题栏承载标签页组、标签页 launcher 和全屏操作，并且没有底部 border。底部面板与右侧面板 toggle 固定在窗口标题栏右缘；右侧面板隐藏时，会话标题栏扩展到该区域下方，同时为这两个控件保留空间。

## Settings 导航

Settings 与工作区使用同一个可调整宽度的 Desktop sidebar shell，并共享 titlebar 几何、紧凑横向留白、折叠行为和宽度状态；两者只有导航内容不同。Settings 使用一个扁平化、虚拟化的导航列表。返回行、分组标题、普通设置项、可展开的 Agent harnesses 行，以及所有可见 Agent 子项共享一个滚动容器与一个 TanStack Virtual virtualizer。搜索框与主题 footer 留在容器外。展开、搜索和 registry 成员变化会重建扁平 row model；路由变化时会把 active item 滚动到可见区域。Agent 子项绝不创建嵌套滚动容器或第二个导航 virtualizer。Agent harnesses 父项只是展开控件，不对应页面，因此不会进入 active 状态。其子项来自用户的 Agent registry；Server 初始化时会注册四个原生 harness。

当 catalog 中所有 harness 都已加入 registry 时，Agent harnesses 行上的添加操作会禁用；否则会打开与 trigger 边缘对齐的选择器，并在各选项中显示 harness 描述和可安装版本。选中后只创建 Agent registry 记录并立即打开其设置页。子项使用灰色、黄色、绿色或蓝色圆点，分别表示未安装、已安装但禁用、已启用但未运行，以及运行中的 Agent。对于有多个会话实例的 Agent，只要任一实例仍在运行就保持蓝点；Claude 以活跃查询为准。设置页打开时每五秒刷新 Agent 列表，以更新运行状态。未安装 Agent 的菜单可将其从 registry 删除。Agent harness 路由使用 `/settings/agent-harnesses/$agentId/$sectionId`。Header 显示当前版本；未安装 harness 的 Install 操作及百分比进度位于安装提示框内。已安装但禁用的 harness 会以 Enable 提示框替换 section 内容，并禁用 section 导航。已安装 harness 在维护菜单中提供 Restart 和带警示颜色的 Uninstall 项。重启前必须经过警示确认，因为它会强制停止 harness、关闭其活跃线程并中断进行中的工作，然后再重新启动。卸载会保留导航项并让页面回到 Install 提示框。带颜色的 Update 按钮在执行期间展开显示百分比进度；与 Install 一样，重新进入页面时会从共享 operation 列表恢复运行进度和失败状态。Uninstall 确认对话框使用带文字的破坏性按钮，并在那里显示进度。当共享语义化版本比较确认当前可用的 catalog 版本高于已安装版本时，原生和 registry harness 才显示 Update。对原生 harness 而言，可用版本是 Cypheria 已测试的原生 harness 清单中的精确版本。Operation 状态按 Agent 隔离，所以安装、更新或卸载一个 harness 不会禁用另一个。所选 Agent 拥有第二级 section 菜单；窄屏时转换为选择器。Codex 提供 Authentication 和合并的 Settings 页面，用于权限、模型默认值和功能设置。其他 harness 保留 Models 和发现型设置分类。右侧 panel 显示具体 section。Agent Header 上方保留单一折叠 Network proxy 卡片，用于配置所有 Agent 共享的 Server 设置，且不会把凭据返回 renderer。其下方的第二张折叠卡片列出供 Agent harnesses 使用的托管 Node.js、Python 和 uv 工具链。界面不显示固定版本或已是最新的标签；可用的安装或更新操作使用图标按钮，并在执行期间展开显示百分比进度。其他 harness 的 Models 页面使用固定高度的虚拟列表，支持 provider 过滤和显式 Server 刷新。Codex Settings 的模型列表读取 App Server `model/list`；Set default 按钮在悬浮或键盘聚焦时出现。设置变更立即保存，也可显式刷新模型列表。

Authentication 页面使用面向用户的 Configure 与 Disconnect 操作。单账户 harness 在配置前显示互斥认证方式，认证后改为显示账户详情、连接测试和 Disconnect。Pi 与 OpenCode 为每个已连接 provider 显示一行，并提供 Add provider 对话框。该对话框第一步只搜索尚未连接的 provider，第二步把所选 provider 的认证方式显示为互斥单选列表。API key 表单通过 OK 完成；浏览器和 command flow 成功后自动关闭；失败会保留错误信息和可执行清理的 Cancel 操作。

Codex Agent 设置通过 App Server 编辑原生 model 与 permission 默认值。Composer 权限菜单与之分离：它始终包含 [Codex Permissions](codex-permissions.zh-CN.md) 记录的四种模式，新 chat 的选择保存在 Server 配置，已有 chat 的选择保存在该 Thread 的权威配置中。

## 会话工作区

所有 Agent 共享同一个会话 shell：

```text
AgentChatWorkspace
  ├─ CommonChatHeader
  ├─ CanonicalTimeline
  │   ├─ CommonTimelineItem
  │   └─ ProviderTimelineExtension
  ├─ CommonComposer
  └─ SharedPanels
```

工作区文件以标签页形式在右侧面板打开，每个文件一个标签页。**打开文件**标签页显示所选 Thread 各 root 的工作区文件树；在其中、在已打开文件旁的文件树中、通过回复中的链接，或在 Review 中点击**在标签页中打开**选择文件，都会在该文件自己的标签页中打开它，并滚动到链接指定的行。文件标签页显示文件的面包屑、源码或预览、编辑、跳转到行，以及可切换并可选择 root 的工作区文件树。**显示 git blame** 会在行号栏中显示每行的作者和日期，同一提交的连续行只在首行标注，悬停时显示作者、提交、日期和摘要。复制菜单可复制绝对路径、相对于仓库或 Thread 文件夹的路径、文件内容；源为 GitHub 时还可复制该文件在上游分支或默认分支上的链接，**在 GitHub 中打开**也会打开该链接。文件树保留 `@pierre/trees`，只在打开 root 或目录时加载直接子项，并支持请求合并、取消、Server 分页读取、按通知定点刷新，以及可取消的名称／路径搜索。文本写入使用 opaque version；二进制预览通过协议二进制流传递，不把字节嵌入 JSON。删除会把条目移入 Server quarantine 并提供一次恢复操作；projectless workspace 的生命周期删除与之分离。打开的文件标签页属于右侧面板布局；root 选择、展开目录、树可见性和树宽度按 Thread 保存在 Desktop 本地状态。

Projectless Thread 使用一个托管 root，布局为 `<projectless folder>/<YYYY-MM-DD>/<name>/`，日期取 Server 本地日期。`<name>` 是首条消息前六个 ASCII 单词用 `-` 连接的结果（最长 80 个字符，没有单词时为 `new-chat`），重名时依次追加 `-2`、`-3`。其直接用途目录为 `work/` 与 `outputs/`。Root 本身是 Thread cwd，这两个子目录不是额外 roots。General 中的 projectless folder 设置会同步到本地 Server，并影响之后创建的托管 workspace。残留托管目录只能通过显式 cleanup 操作删除。

Agent 的回复可以包含由 Desktop 转为交互的引用。Agent 写出的每个路径都是 Server 主机上的路径，因此 Desktop 绝不自己打开它：`thread.paths.resolve` 把它映射到 Thread root，由文件标签页打开，`thread.files.read` 提供字节。指向文件的 Markdown 链接会在该文件自己的标签页中打开并定位到链接的行，指向目录的链接会在“打开文件”标签页中显示该目录；Markdown 图片可显示位于 Thread root 下的图片、音频或视频，以 object URL 呈现并在离开屏幕时释放。位于 roots 之外的路径或过大无法预览的文件显示为不可用，且不会被读取。指令 `::code-comment{…}`、`:codex-followup[…]{prompt="…"}` 和 `::created-thread{…}` 分别渲染为可打开其文件的评论卡片、把 prompt 作为下一条消息发送的 follow-up 按钮，以及指向所创建对话的链接；只是看起来像指令的内容仍保持为文本。Web 链接沿用默认处理，`cypheria://review` 链接会在会话的 Pull Request 面板中打开该拉取请求。无法渲染这些内容的 client 会把相同的 Markdown 显示为可读文本。

该体验的能力归属与后端选择规则详见[本地 Git 设计](git.zh-CN.md)；拉取请求和合并请求见[代码审查](code-review.zh-CN.md)。

对于有本地工作目录的会话，Codex 的 Review 面板通过 Server Git API 读取仓库。它展示已暂存及未暂存的文件和文本差异，以及从默认分支的共同祖先算起的已提交分支变更。分支差异固定 HEAD 快照，HEAD 变化后会拒绝读取过期差异。面板提供仓库初始化、分支创建与切换、文件暂存、取消暂存、提交、推送，以及托管工作树的创建、删除和恢复操作。分支选择可检索最近的本地及远端引用；选择远端引用会创建本地跟踪分支。删除工作树要求其没有未提交改动，并保存已提交的 HEAD，供在面板中恢复。面板优先使用会话工作目录，并在打开时刷新本地状态。

Review 的未暂存来源也会在文件暂存前展示未跟踪普通文件的文本差异。

工作目录位于仓库内的 Thread 会在会话标题栏显示其分支。分支按钮打开一个弹层，可提交（使用手写或自动生成的提交信息，并可选择包含未暂存变更）、提交并推送，或仅推送；当分支有拉取请求（通过 Thread 附件或代码审查找到）时，标题栏显示其编号和状态，菜单提供在 Pull Request 面板中查看 PR、在 GitHub 或 GitLab 中打开、复制链接和添加到聊天；否则“创建 PR”会在编辑器中填入创建请求。弹层与 Review 面板使用同一套 Server Git API 和提交代码。

其他应用通过 `cypheria://` scheme 访问 Desktop，Desktop 会向操作系统注册该 scheme。`cypheria://threads/<threadId>` 打开一个 Thread，加 `?view=review` 还会打开其 Review 面板；`cypheria://review?pr=<url>&path=<file>&line=<n>&side=<left|right>` 在当前显示的 Thread 的 Pull Request 面板中打开该拉取请求。Desktop 只接受这两种形式（拉取请求 URL 必须是 `https`），并在 renderer 内部路由；`cypheria://app/` 和 `cypheria://media/` 仍是 renderer 自身的来源。窗口尚无法接收时到达的链接会等到 renderer 来取。

“未提交”来源相对 HEAD 合并展示 index 与工作目录的更改，包括未跟踪文件。仓库尚无第一次提交时，则组合已暂存与未暂存差异。

“提交”来源列出最近的提交，将选定提交与第一个父提交比较；根提交则与空树比较。文件差异使用固定的提交哈希，之后的工作目录变化不会改变该 Review。

对于本地 Codex 轮次，Server 在轮次前后通过临时 Git index 保存仓库中未被忽略的文件快照。两个 tree 固定在 `refs/cypheria/turn-diffs` 下，最近完成的捕获记录保存在 `CYPHERIA_HOME/git-turn-diffs`。“最后一轮”来源从这两个 tree 读取差异，包含未跟踪文件，且不会修改真实 index。快照以尽力而为方式执行；Git 快照失败不会阻止轮次运行。

Review 的已暂存和未暂存文件由 Server 提供 revision。整文件或单个文本段落的暂存、取消暂存操作会在修改 index 前重新核对 revision；过期操作会失败并刷新 Review。未暂存来源还支持经确认后撤销整文件或单个文本段落的更改。撤销前 Server 将原文件或符号链接保存在 `CYPHERIA_HOME/git-review-undo`，面板在重启后仍列出已保存的撤销记录并提供恢复操作；撤销后文件再次变化时会拒绝恢复。新增、删除及二进制文件仍以整文件操作。

Review 用与工作区文件树相同的文件树组件展示变更文件，带 Git 状态颜色、增删行数、评审评论数和筛选框。所选文件的 diff 位于其旁（窄面板中位于其上），使用下文所述的共享差异选项和“已查看”标记；文本段的暂存、取消暂存和还原操作位于该段开头。Agent 回复中的 `::code-comment` 发现也会显示在对应行之下，标明 Agent 名称，并计入文件树的评论数；可将其从 diff 中隐藏，但仍保留在对话中。点击行旁的添加按钮（或先在同一侧选中多行）即可写评审评论；待发送的评论随 Thread 保存，点击**发送给 Agent**后作为一条消息发出，消息用绝对路径和行号或行范围标明每个位置。提交、分支和工作树控件是 diff 下方可折叠的分区。Review 按目录组织变更文件，并可复制路径、将路径引用插入聊天输入框、通过**在标签页中打开**打开该文件的工作区标签页、用默认应用打开仓库中现有的文件，或另存副本。Electron main 在打开或复制前解析文件，并确认它仍是已发现仓库内的常规文件。提交控件可纳入未暂存的变更、记录共同作者，并支持提交后推送；推送失败时已成功的提交会保留，可单独重试推送。

Review 的六种来源都支持不区分大小写的路径筛选和忽略空白变更的显示选项。分支 Review 可选择本地或远端基准分支。Server 从 Git 的 NUL 分隔 numstat 输出提供逐文件增删行数；面板显示可见文件的计数及合计。忽略空白选项也会过滤这些计数。由于过滤后的段落不能安全地定位原始补丁段落，该模式隐藏段落级修改；整文件操作仍使用未改变的文件 revision。二进制及未跟踪文件不显示行数。

这些 Git 操作属于客户端。Agent 自己使用 `git` 和 `gh`，并通过随附的 `code-review` 插件读取拉取请求的检查；见 [Cypheria app tools](integrations.zh-CN.md#cypheria-app-tools)。

拉取请求和合并请求在侧边栏的**代码审查**页面以及会话的 **Pull Request** 面板中打开。两者都承载代码审查 MCP App，需要 ChatGPT 登录并连接 GitHub 或 GitLab；其行为（包括监控并修复）见[代码审查](code-review.zh-CN.md)。

Review diff 使用共享代码查看器渲染，带语法高亮、词级差异、按文件的增删统计，并对大补丁做虚拟化滚动。差异选项菜单可选择“自动”“并排”或“统一”布局（“自动”在视图足够宽且文件同时有增删时并排显示）、词级差异和自动换行，并保存为 Desktop 客户端状态；它还能把补丁复制为 `git apply` 命令。菜单还可隐藏只改动顶层 import 的 hunk，以及隐藏生成的文件，即锁文件、压缩包、source map、快照，以及仓库 attributes 标记为 `linguist-generated` 的路径。Review 对所有来源都可通过 Server 加载完整文件。工作树中未跟踪文件超过 2,000 个时，Review 只显示已跟踪的变更，并可复制交互式 `git clean` 命令。“跳转到文件”可搜索变更文件。每个文件标题可折叠该文件并标记为“已查看”；已查看的文件会折叠、在文件树中显示勾号，其 diff 变化后会重新视为未查看。

Review 面板在 Desktop 客户端状态中记住最近选择的来源；若该来源需要当前不存在的线程，则回退到未暂存改动。Pull request 通过共享 Thread Attachment API 附加到聊天或解除附加。Desktop 读取 Server 权威关系，支持从 PR 反查关联聊天，响应附件通知，并在 Git 设置允许时于侧边栏显示附加图标；未来的 Expo、Web 与 CLI 客户端因此能看到同一关系。Git 设置仍保存在 Server 配置中。Server 在共享审计日志中记录 Git 修改操作的开始及结果，并关联请求 ID；审计事件不包含路径、提交消息或文件内容。

托管工作树可在 Cypheria 的工作树元数据中持久记录所属线程 ID。Server 在关联本地 Codex 线程时，会核对同一仓库及线程当前使用的工作树；有归属线程的工作树必须在线程迁走后才能删除。

Review 面板可将空闲的本地 Thread 在检出目录与活跃托管工作树之间移动。Server 会拒绝在轮次运行中或存在待处理交互时移动，要求所选 Agent adapter 修改工作目录，更新工作树归属及其 Thread Attachment；移动失败时恢复原工作目录。公共路径支持所有实现工作目录变更的 Agent adapter。两个检出目录的 HEAD 相同且目标干净时，移动可选择复制本地改动；源目录中的文件仍会保留。
线程从仓库子目录出发时，Server 会将它移到目标工作树中的相同相对目录。目标目录不存在或解析到工作树之外时，移动会被拒绝。
Review 面板可从 `HEAD` 或选定的本地、远端分支创建分离状态的托管工作树；源检出目录保持在原分支。
创建时，Server 会复制被忽略的 `AGENTS.override.md` 文件，以及源仓库根目录的 `.worktreeinclude` 所选中的被忽略普通文件；跳过符号链接和目标中已有的文件。
Review 面板的工作树控件可选择包含本地改动及仓库内环境配置，并展示创建进度、setup 输出、取消、重试和跳过 setup。未选择环境时跳过 setup。
若从不同于当前 checkout 分支的本地分支创建托管的 detached worktree，它会记录同步分支的基线。源 checkout 干净且目标分支仍指向已记录的基线时，Review 可将 worktree 中已提交和未提交的变更同步到该分支。Server 通过临时索引为未提交变更创建快照，将先前的分支提交保存在 `refs/cypheria/worktree-sync/*`，并提供撤销。若两个工作树的 HEAD 相同且目标干净，线程迁移可选择复制已暂存、未暂存及未跟踪的常规文件；源目录保留文件以便恢复。setup 脚本对安全工具链环境变量的更改会捕获到 worktree Git 目录，并保存在托管元数据中供恢复。

共同体验包括草稿、附件、临时到持久 Thread 转换、每 Thread scope、流式输出、取消、重试、虚拟 Timeline、滚动锚点、位置恢复、未读、搜索、导航、reasoning、plans、tools、commands、diffs、terminals、approvals、artifacts 和故障恢复。

终端面板订阅所选 Thread 的共享[终端目录](terminals.zh-CN.md)。远端创建会增加后台 tab，但不会改变本地焦点或面板显隐；隐藏或卸载面板只释放 stream 订阅。尚未持久化的草稿不能创建终端。交互式认证会为其私有终端复用 stream renderer，但不会增加工作区 tab。

Harness 专属 UI 仅限判别 Timeline 扩展、header actions、model settings、permission details 和真实 harness capabilities。Codex 仍是保真参考，但 Claude、Pi、OpenCode 和 ACP 复用同一 shell，而不是复制整套 UI。

Composer 使用共享的 `ChatModelSelector` 与 `ChatContextUsage` 展示组件。Selector 把 Agent、model、推理强度与速度合并起来，并隐藏所选 Agent 未广告的维度。首条消息发送前，切换 Agent 会改变新 Thread 使用的 runtime；已有 Thread 保持其 Agent identity。新 chat 还提供 project 选择器和明确的清除操作。当 project 的第一个 root 是 Git 仓库时，用户可以勾选 **Worktree** 并选择本地或远端起始分支。首次提交时，Desktop 会先创建托管 worktree，再创建 project Thread，并在启动首个 turn 前把 Thread 移入且关联该 worktree；若设置失败，则回滚本次创建的资源。Project 的其他 roots 仍会直接访问。已有 Thread 不显示这些创建控件。Context control 是一个紧凑 meter，hover card 会针对 Codex、Claude、Pi、OpenCode 与 ACP 显示不同明细，并用 source label 区分 reported、queried、derived 与 estimated。Chat Demo 同时展示这两个组件，开发者无需真实 Agent 即可切换检查所有呈现变体。

共享的 `ChatComposerEditor` 使用 Tiptap/ProseMirror，支持富文本和选中的语义引用。Server 提供并校验 `@` 与 `$` 候选项；Desktop 处理可执行的 `/` 命令。选中的引用成为有序协议输入块；未选中的触发器文本仍是普通文本。`ChatComposerAttachmentList` 将二进制和其他上下文保留在编辑器文档外，并提供受控状态、移除和重排。Desktop 的显式纯文本偏好仍使用 textarea 路径。所有权、上传和 Agent 映射详见 [Composer 输入与引用](composer.zh-CN.md)。

Canonical Timeline 历史与有序实时更新都直接通过 `@cypheria/client` 消费。无框架 controller 负责分页、重连、缺口恢复、send、steer、Codex 原生 queue、cancel 和 interaction；React 通过 `useSyncExternalStore` 订阅。Codex 使用专用 workspace，其他 Agent 在获得专属扩展前使用公共 Thread workspace。

Codex workspace 在 Canonical Timeline 投影后执行仅属于 Desktop 的展示分组，不改变已存储 item，也不发明 App Server item 类型。用户输入、过程 commentary、连续工具或子代理活动、plan、diff、最终回答和回答后通知成为不同的虚拟行。最新轮次只跟踪当前同步 commentary；异步投递或提问会清除该标记。原始顺序中最终回答之后仍可能有已完成活动，因此分组会越过已结束的命令和工具查找最终回答，并把回答显示在过程组之后。待处理审批留在 composer 交互区；goal、queue、usage 等运行时状态不进入历史。若 Codex MCP elicitation 的 metadata 表明它是 Computer Use 应用访问请求，还会显示屏幕截图与访问披露，并在适用时显示高风险标记；它不会成为 Timeline item。共享 `ChatTurnGroup` 只负责展示；开发版 Chat Demo 在 128 条消息的虚拟化会话之外，也用同一分组函数展示双轮次样例和 Computer Use 请求样例。

## Codex Summary 概览

Codex 的独立 Summary 概览从会话标题栏打开，不再是右侧面板 tab。它可以浮于会话之上，也可固定并依据会话区域的实测宽度留出空间（低于 1096 px 时覆盖，至 1536 px 时局部偏移，更宽时留槽）。右侧详情 tabs 与底部面板保持独立。打开、固定和区块展开状态按 Thread 保存在 Desktop 客户端 KV 的 `thread-summary-ui:<threadId>`；隐藏内容设置 inert，关闭后焦点返回标题栏开关。

概览只组合真实数据：Outputs、Sources、Subagents 和最新 Plan 来自 Server 的完整历史 [Thread Summary 投影](protocol.zh-CN.md#canonical-timeline)；原生后台进程使用 Codex facade；线程终端使用共享终端目录；关联 PR 使用 Thread Attachments；Schedules 限定当前 Thread；Browser 列出 Desktop 内置且属于该线程的 tabs。条目打开相应已有详情 tab 或路由。单一来源失败只显示自身错误，不隐藏其他区块。Environment、Usage、Computer Use、外部 Chrome Browser Use、缺少来源关联的 created tasks 和缺少线程关联的 side chats 不属于 Summary 区块。

## Desktop 本地设置

Electron 将 Desktop 私有偏好以版本 1 值保存到 `userData/kv.sqlite`。语义化 key 不添加产品或平台前缀。Appearance、`localeOverride`、General、Composer、Panel、Notifications、Sidebar、Git UI 与未读活动各自使用窄 Schema。Renderer 状态由 Jotai 管理；临时表单编辑值在确认前仍属于组件状态。Electron main 在创建窗口前读取 appearance 与 locale，并为相关 key 应用菜单、休眠、通知与声音副作用。选择目录或声音等 OS 操作继续使用窄 IPC。

常规设置页将本地偏好分为 Permissions、General、Composer 和 Notifications。General 包含无项目任务默认目录（默认 `~/Documents/Cypheria`）、动态发现的本机文件打开应用、界面语言、菜单栏驻留、底部面板控件、终端位置和防止休眠。Composer 包含纯文本输入、上下文窗口用量、三种 Enter 发送模式和跟进消息行为。Notifications 包含任务完成提醒模式、权限与问题提醒，以及内置 Default 和 Classic、None、从 macOS 发现的声音和自选声音文件。选中声音时立即试听；选中 None 时停止试听。Codex 插件可用性在 Codex Settings 中配置并由 Codex 保存，见 [Codex 配置](codex-app-server-config.zh-CN.md)。

共享 Agent、model、integration、Web3 和 Server 行为属于 Cypheria Server 配置或数据库。UI 偏好不会写入 Codex 配置。

其他本地 UI 状态、可重建 Replica 与附件二进制使用共享的[客户端存储](client-storage.zh-CN.md)端口。Electron main 同时拥有 Desktop SQLite 键值数据库、Replica 数据库和附件文件；renderer 只能通过经过校验的 preload IPC 访问。它们与权威 Server 数据库保持分离。

已有 Thread 的 Composer 文本与有序附件 metadata 保存在 `composerDraft:<threadId>`；所有尚未创建 Thread 的空白聊天共用固定 `composerDraft:new`，并使用 250 ms debounce 和 page-hide flush。路由 search 不再携带草稿身份。Server 创建 Thread 后，Desktop 会把共享的新聊天草稿移动到该 Thread 的 key。文件选择通过 Electron `webUtils.getPathForFile()` 与 main 进程直接复制；只有剪贴板、粘贴文本、截图等已经在内存中的来源才使用受限 bytes 路径。提交失败时完整保留草稿。二进制缺失会显示为不可用，且不能提交。

Timeline 消息菜单由 Server 公布的逐边界 capability 决定。`turn-user` 消息可以显示 **Rewind to here** 与 **Fork in new chat**；`assistant-final` 消息可以显示 Fork；steer 消息、流式或未成功完成的 assistant 消息、tools、reasoning 和其他 items 均不显示这些操作。Rewind 在覆盖非空草稿前要求确认，且仅在 Server 操作成功后写入返回的 input blocks。用户消息 Fork 会把这些 blocks 写入新 Thread 草稿；assistant 与 thread-head Fork 使用空 composer。分支操作进行时，相关操作与提交会被锁定。

主窗口把用户改动后的 Thread 布局保存在 `panelLayout:<threadId>`，包括左右／底部 panel 的可见性与尺寸、右侧 tab 状态、全屏状态和焦点。新 Thread 使用代码中的固定默认值，在用户改变 workspace 前不创建布局值。其他窗口只在内存中保留布局。恢复时会过滤不支持的 tab。

开发构建会提供 `/debug` 路由和仅开发模式显示的 Sidebar 入口。其紧凑左右布局可以浏览键值状态、Replica 记录与附件二进制，并支持查询、keyset 分页、受限文本预览和受限二进制前缀。非 Desktop 开发模式访问该路由会重定向到主工作区，生产导航也不会显示入口。

Git、工作树和代码审查设置沿用官方桌面端的页面，并将其值保存在 Server 配置中。

- **Git** 包括基于 Git 的 diff（仅最后一轮的审查模式）、分支前缀、合并方式、带租约的强制推送、草稿拉取请求、审查呈现方式（内联或独立）、监控并修复（自动合并与监控说明），以及提交和拉取请求说明。说明在停顿后自动保存。
- **工作树** 包括工作树根目录（Server 重启后生效）、每个新工作树创建前的上游刷新，以及自动删除及其上限；关闭自动删除需要确认。其下按仓库列出托管工作树及其关联的对话，可在某个工作树中新建聊天，并在没有聊天使用时删除工作树。
- **代码审查** 承载代码审查 App 的设置；见[代码审查](code-review.zh-CN.md#desktop-界面)。

Review 面板遵循仅显示最后一轮的模式。

创建托管工作树后，Server 可按保留数量设置清理最多五个较旧的托管工作树。它会保护源 checkout、新建工作树、活跃或未归档线程使用的工作树、含未提交改动的工作树，以及最近十分钟创建或更新的工作树。归档和线程迁移也会触发清理；必要时会先从快照恢复已归档线程的工作树再取消归档。被清理的工作树仍保留 Git 快照，可恢复。清理失败不会撤销成功的工作树创建。

对于新建或恢复的托管 Codex 线程，Server 会将配置的分支前缀和提交、PR 指令写入 Codex developer instructions。

## 浏览器与 dApp 边界

每个窗口都可以承载内置浏览器。改编的浏览器代码的第三方声明见 `NOTICE`。

### 标签页与配置

每个浏览器标签页（无论网页还是 dApp）都只属于一个 Thread，并显示在该 Thread 的 Browser 面板中；用户也在这里打开网页和 dApp 标签页，Thread 之外没有浏览器。删除 Thread 会关闭其标签页；每次连上 Server 时，也会关闭所属 Thread 已不存在的标签页，以覆盖 Desktop 错过的删除。设备本地的标签页索引保存在 Desktop client KV 中，由所有窗口共享，最多保留最新的 200 个标签页；损坏的记录会被单独丢弃。页面状态保存在每个窗口为该标签页创建的 guest 中。窗口向 Server 上报自己已启动的标签页，以及尚无窗口启动的已恢复标签页，后者由最早注册的窗口接手；一个窗口关闭某个标签页时，其他窗口会移除自己对应的 guest。Guest 统一放在 React 面板之外的固定定位容器里：可见面板把当前标签页定位到自身上方，隐藏的标签页停放为 1×1，页面仍会运行，Agent 也仍可操作。恢复的标签页在首次显示或被自动化时从保存的 URL 加载。输入框的 `@` 菜单会列出该 Thread 已打开的标签页。

每个标签页都有类型。网页标签页共享 `persist:cypheria-browser` 配置，永远不会获得钱包。dApp 标签页共享独立的 `persist:cypheria-dapp-browser` 配置。切换标签页类型会重建 guest，因为 guest 挂载后配置无法更改。Electron main 拒绝其他 partition 或 preload，拒绝设备权限，阻止非 HTTP(S) 导航；需要 `window.opener` 的 `window.open` 弹窗以没有 preload 的沙箱窗口打开，其他新窗口请求会变成同类型的标签页。地址栏聚焦和重新加载快捷键在 guest 中保留，其他按键交给页面处理。

### Agent 操控

Electron main 和每个窗口都以 Desktop 在该 Cypheria home 下保留的同一个 client ID 连接，因此 Server 把它们合并为一个 session。每个窗口注册自己的 browser host，并对调用方 Thread 的标签页和它显示的 MCP App 执行来自 [Computer Use](computer-use.zh-CN.md#host) 的命令。Electron main 注册本设备的 computer host。快照提供无障碍树 ref，页面变化后 ref 失效；点击、按键、悬停和拖拽在目标可见、可用且稳定后，通过 Chrome DevTools Protocol 以可信输入执行。JavaScript 对话框会被处理并报告，不会阻塞。上传在解析符号链接后只接受 Thread 工作目录内的文件。MCP App 操作在 App 的沙箱 frame 内以合成事件执行。针对本设备外部浏览器和原生应用的请求直接到达 Electron main；Electron main 运行 agent-browser、托管 cua-driver daemon，并申请其所需的 macOS 权限，详见 [Computer Use](computer-use.zh-CN.md#桌面应用)。**设置 → 通用 → 电脑操控** 显示各开关和本设备的权限。Server 契约见 [Protocol](protocol.zh-CN.md#computer-use-host)。

### dApp 标签页

钱包权限和 session 仍然按 origin 隔离。Electron main 根据发出请求的 frame 的 origin 推导每个 provider request 的范围，拒绝子 frame 和不匹配的 session key，并在某个 origin 首次使用 provider 时打开 Server 上的 dApp session。Provider event 会发送到当前显示该 origin 的所有 dApp 标签页。dApp 配置中的跨站请求和响应会移除 Cookie；这不涵盖第三方 frame 内通过 `document.cookie` 的访问，分区（CHIPS）Cookie 也会被移除。清除某个网站的数据会从 dApp 配置中删除其存储，但不会撤销钱包权限。签名和策略评估仍在特权 Server runtime 中进行；即使由 Agent 操作页面，来自 dApp 标签页的签名意图仍保持 `dapp` 来源。

## 跨平台要求

macOS、Windows 和 Linux 都是一等目标。平台专属代码留在 Electron main 或打包脚本中，并须保持：

- 原生 path、process 和 signal 行为；
- 窗口与 tray 约定；
- 代码签名和更新边界；
- 包括 `node-pty` 在内的原生模块重建；
- Server executable 发现和日志访问。

Sidebar 或会话行为变更必须进行交互测试和视觉评审。发布前的打包验证必须覆盖三个桌面平台。
