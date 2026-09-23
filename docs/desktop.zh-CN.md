---
title: Desktop
---

# Desktop

`apps/desktop` 是 Cypheria 的主客户端，由 Electron main、preload 与 TanStack Start renderer 组成，保留紧凑、面向工作区的 Sidebar 和会话体验。它不与 Expo 共享应用 shell。

## 进程边界

- Electron main 负责窗口、应用生命周期、Server 管理、桌面设置、安全存储、更新、原生菜单、操作系统集成和隔离的 dApp browser views。
- Preload 为 Electron 专属能力暴露狭窄的类型化 IPC。
- TanStack renderer 直接通过 `@cypheria/client` 使用共享产品状态并消费实时 Agent turns。
- dApp preload 向隔离 origin 暴露受限 provider bridge；绝不暴露 Node.js 或密钥材料。

Browser view 默认关闭 `nodeIntegration`，开启 `contextIsolation`、sandbox 和 web security。

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

既有交互模型是产品不变量：

- Pinned、自定义 Sections、Projects 和 recents 保持层级与视觉密度。
- Project Threads 保持嵌套，并支持展开、分页和“显示更多”。
- 协议允许时，选择、创建、重命名、归档、删除、固定、取消固定、拖放、跨 Section 移动和排序保持可用。
- 上下文菜单、键盘导航、未读状态和运行状态保持可见。
- 加载、空、错误和乐观状态保持布局，失败 mutation 会回滚。

Query key 和乐观更新基于 Cypheria ID。Harness session ID 不会替代 Thread ID 成为导航或缓存身份。

## 页面标题栏

Desktop 不会在所有路由上方全局预留标题栏。需要共享窗口 chrome 的路由自行渲染 `PageHeader` 并传入自己的子组件；不需要标题栏的路由则从内容区顶部开始填充。`PageHeader` 负责标准的 44px 几何尺寸、Electron 拖拽区域，以及让页面内容与 Sidebar 展开/折叠标题栏控件联动的左侧 inset 动画。

会话工作区有意不使用 `PageHeader`。它的 chrome 按 Chat Demo 参考拆分为会话 `ChatHeader` 与右侧 `ChatPanel` workspace header。会话标题栏参与同一套 Sidebar inset 过渡；右侧标题栏承载标签页组、标签页 launcher 和全屏操作，并且没有底部 border。底部面板与右侧面板 toggle 固定在窗口标题栏右缘；右侧面板隐藏时，会话标题栏扩展到该区域下方，同时为这两个控件保留空间。

## Settings 导航

Settings 与工作区使用同一个可调整宽度的 Desktop sidebar shell，并共享 titlebar 几何、紧凑横向留白、折叠行为和宽度状态；两者只有导航内容不同。Settings 使用一个扁平化、虚拟化的导航列表。返回行、分组标题、普通设置项、可展开的 Agent harnesses 行，以及所有可见 Agent 子项共享一个滚动容器与一个 TanStack Virtual virtualizer。搜索框与主题 footer 留在容器外。展开、搜索和 registry 成员变化会重建扁平 row model；路由变化时会把 active item 滚动到可见区域。Agent 子项绝不创建嵌套滚动容器或第二个导航 virtualizer。Agent harnesses 父项只是展开控件，不对应页面，因此不会进入 active 状态。其子项来自用户的 Agent registry；Server 初始化时会注册四个原生 harness。

当 catalog 中所有 harness 都已加入 registry 时，Agent harnesses 行上的添加操作会禁用；否则会打开与 trigger 边缘对齐的选择器，并在各选项中显示 harness 描述和可安装版本。选中后只创建 Agent registry 记录并立即打开其设置页。子项使用灰色、黄色或绿色圆点分别表示未安装、已安装但禁用和已启用，并提供从 registry 删除未安装 Agent 的菜单。Agent harness 路由使用 `/settings/agent-harnesses/$agentId/$sectionId`。Header 显示当前版本；未安装 harness 的 Install 操作及百分比进度位于安装提示框内。已安装但禁用的 harness 会以 Enable 提示框替换 section 内容，并禁用 section 导航。已安装 harness 提供 Restart 菜单项和用于 Uninstall 的破坏性图标按钮。重启前必须经过警示确认，因为它会强制停止 harness、关闭其活跃线程并中断进行中的工作，然后再重新启动。卸载会保留导航项并让页面回到 Install 提示框。Update 与 Uninstall 图标按钮会在 operation 执行期间展开显示百分比进度。当共享语义化版本比较确认当前可用的 catalog 版本高于已安装版本时，原生和 registry harness 才显示 Update。对原生 harness 而言，可用版本是 Cypheria 已测试的原生 harness 清单中的精确版本。Operation 状态按 Agent 隔离，所以安装、更新或卸载一个 harness 不会禁用另一个。所选 Agent 拥有用于 authentication、models 和发现型设置分类的第二级 section 菜单；窄屏时转换为选择器。右侧 panel 显示具体 section。Network proxy 位于 Agent header 上方并默认折叠。它正下方的第二个折叠卡片会列出供 Agent harnesses 使用的托管 Node.js、Python 和 uv 工具链。界面不显示固定版本或已是最新的标签；可用的安装或更新操作使用图标按钮，并在执行期间展开显示百分比进度。Models 使用另一个固定高度虚拟列表，支持 provider 过滤和显式 Server 刷新。

Authentication 页面使用面向用户的 Configure 与 Disconnect 操作。单账户 harness 在配置前显示互斥认证方式，认证后改为显示账户详情、连接测试和 Disconnect。Pi 与 OpenCode 为每个已连接 provider 显示一行，并提供 Add provider 对话框。该对话框第一步只搜索尚未连接的 provider，第二步把所选 provider 的认证方式显示为互斥单选列表。API key 表单通过 OK 完成；浏览器和 command flow 成功后自动关闭；失败会保留错误信息和可执行清理的 Cancel 操作。

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

对于有本地工作目录的会话，Codex 的 Review 面板通过 Server Git API 读取仓库。它展示已暂存及未暂存的文件和文本差异，以及从默认分支的共同祖先算起的已提交分支变更。分支差异固定 HEAD 快照，HEAD 变化后会拒绝读取过期差异。面板提供仓库初始化、分支创建与切换、文件暂存、取消暂存、提交、推送，以及托管工作树的创建、删除和恢复操作。分支选择可检索最近的本地及远端引用；选择远端引用会创建本地跟踪分支。删除工作树要求其没有未提交改动，并保存已提交的 HEAD，供在面板中恢复。面板优先使用会话工作目录，并在打开时刷新本地状态。对于 GitHub.com origin，`gh` 路径展示账户和仓库可用性、打开的 PR 及其详情、PR 检查、讨论评论与审查，并支持创建 PR、编辑标题和正文、草稿与可审查状态切换、关闭与重新打开，以及在确认后按匹配的头部提交合并。状态变更及发送新评论或审查前，会比较显示时的头部 SHA 与当前 PR 的头部提交。检查状态包含通过、失败、待处理、跳过和取消。若 `gh` 无法访问仓库，已连接的 GitHub App 可以检索最近打开的 PR、读取详情，并从本地 Codex 线程中已推送的当前分支创建 PR。该路径按操作在同一账户 link 中选择工具，验证 `get_repo` 访问和 PR URL，并在系统浏览器打开新 PR。编辑、检查、讨论写入、状态变更和合并仍由 `gh` 路径负责。对于 GitLab.com origin，面板会按当前分支查找 MR，并提供 MR 详情、分页讨论、reviewer 与批准状态、项目成员搜索、MR 作者的 reviewer 管理、pipeline jobs 与 bridges、标题修改、普通评论、原生创建以及在系统浏览器打开预填表单；原生操作要求本地 Codex 线程和已连接的 GitLab App。若部分 pipeline 页面加载失败，结果会标明不完整。

Review 的未暂存来源也会在文件暂存前展示未跟踪普通文件的文本差异。

“未提交”来源相对 HEAD 合并展示 index 与工作目录的更改，包括未跟踪文件。仓库尚无第一次提交时，则组合已暂存与未暂存差异。

“提交”来源列出最近的提交，将选定提交与第一个父提交比较；根提交则与空树比较。文件差异使用固定的提交哈希，之后的工作目录变化不会改变该 Review。

对于本地 Codex 轮次，Server 在轮次前后通过临时 Git index 保存仓库中未被忽略的文件快照。两个 tree 固定在 `refs/cypheria/turn-diffs` 下，最近完成的捕获记录保存在 `CYPHERIA_HOME/git-turn-diffs`。“最后一轮”来源从这两个 tree 读取差异，包含未跟踪文件，且不会修改真实 index。快照以尽力而为方式执行；Git 快照失败不会阻止轮次运行。

Review 的已暂存和未暂存文件由 Server 提供 revision。整文件或单个文本段落的暂存、取消暂存操作会在修改 index 前重新核对 revision；过期操作会失败并刷新 Review。未暂存来源还支持经确认后撤销整文件或单个文本段落的更改。撤销前 Server 将原文件或符号链接保存在 `CYPHERIA_HOME/git-review-undo`，面板在重启后仍列出已保存的撤销记录并提供恢复操作；撤销后文件再次变化时会拒绝恢复。新增、删除及二进制文件仍以整文件操作。

Review 的六种来源都支持不区分大小写的路径筛选和忽略空白变更的显示选项。分支 Review 可选择本地或远端基准分支。Server 从 Git 的 NUL 分隔 numstat 输出提供逐文件增删行数；面板显示可见文件的计数及合计。忽略空白选项也会过滤这些计数。由于过滤后的段落不能安全地定位原始补丁段落，该模式隐藏段落级修改；整文件操作仍使用未改变的文件 revision。二进制及未跟踪文件不显示行数。

GitHub CLI 拉取请求列表支持服务端关键词搜索，以及打开、已关闭、已合并或全部状态筛选。

对于打开的 GitHub PR，CLI 路径会读取自动合并状态，并可开启或关闭自动合并。开启时使用配置的合并方式，发送操作前会核对页面显示的头部提交。

当 CLI 可访问仓库时，PR 面板会从列表中定位当前分支的 PR，并可读取代码补丁。Server 在读取前后核对面板显示的 PR head SHA；若读取期间 PR 发生变化，则拒绝返回该差异。

PR 面板列出 GitHub 上的精确修订提交，并可读取所选提交的差异。Server 也能读取指定 base 和 head 修订的文本文件内容；二进制或过大的文件会返回不可用。每次修订读取前后都会核对面板显示的 PR head。

CLI 路径可以请求或移除用户及团队 reviewer。修改 reviewer、标题或正文前会比较面板显示的 head SHA，操作后面板会刷新 PR 数据。

CLI 路径也会读取 PR 的新增和删除行数、变更文件数、作者、自动合并状态、可用合并方式、reviewer 请求及分页审查决定。reviewer 搜索使用 GitHub 仓库协作者建议；Server 还提供来自 PR 参与者和可提及用户的提及建议。

CLI 路径还能分页读取审查线程及回复、在变更行发表行内评论、回复线程，并在账户有权限时解决或重新打开线程。评论作者可编辑或删除自己的普通评论及审查评论，也可编辑自己的审查正文。读写前会核对面板显示的 PR head，修改线程前还会检查该线程属于当前 PR，编辑或删除评论前会核对作者。如果超过 100 页的安全上限，面板会标明讨论不完整。

CLI 的 PR 列表支持状态和文本搜索、由我创建及请求我审查的范围，并可每次加载更多 100 条结果，最多 500 条。GitHub App 的结果仍受 connector 提供的范围与数量限制。

CLI 还会独立于当前列表查询当前分支由本账户创建的 PR，优先选择打开的 PR，否则选择已合并的 PR。因此即使 PR 不在当前列表内也可以访问，且不会为同一分支提供第二个打开的 PR 创建操作。

对于本地 Codex 线程中的打开 PR，**修复 PR** 会在该线程发起一轮包含 PR URL 和受约束修复指令的任务。**关注并修复** 会建立持久的 Server 日程，每十分钟运行同一线程。创建时，关注提示会使用已保存的自动合并、合并方式及自定义关注指令；PR 面板可暂停和恢复日程。运行遇到关闭或已合并的 PR 时会报告状态而不修改代码，日程仍保留供用户暂停。

托管工作树可在 Cypheria 的工作树元数据中持久记录所属线程 ID。Server 在关联本地 Codex 线程时，会核对同一仓库及线程当前使用的工作树；有归属线程的工作树必须在线程迁走后才能删除。

Review 面板可将空闲的本地 Codex 线程在检出目录与活跃托管工作树之间移动。Server 会拒绝在轮次运行中或存在待处理交互时移动，随后在目标目录恢复原生线程、更新工作树归属；移动失败时恢复原工作目录。移动只改变线程工作目录，未提交的本地文件仍留在原目录。

共同体验包括草稿、附件、临时到持久 Thread 转换、每 Thread scope、流式输出、取消、重试、虚拟 Timeline、滚动锚点、位置恢复、未读、搜索、导航、reasoning、plans、tools、commands、diffs、terminals、approvals、artifacts 和故障恢复。

Harness 专属 UI 仅限判别 Timeline 扩展、header actions、model settings、permission details 和真实 harness capabilities。Codex 仍是保真参考，但 Claude、Pi、OpenCode 和 ACP 复用同一 shell，而不是复制整套 UI。

Canonical Timeline 历史与有序实时更新都直接通过 `@cypheria/client` 消费。无框架 controller 负责分页、重连、缺口恢复、send、steer、Codex 原生 queue、cancel 和 interaction；React 通过 `useSyncExternalStore` 订阅。Codex 使用专用 workspace，其他 Agent 在获得专属扩展前使用公共 Thread workspace。

## Desktop 本地设置

Electron 在 `userData/config.json` 保存本地偏好：

- 外观、语言、字体、密度和布局；
- 快捷键、声音、窗口边界和 panel 状态；
- Server 自动启动、executable 和首选端口；
- browser、更新、tray 和 OS integration 行为。

常规设置页将本地偏好分为 General、Composer、Popout Window 和 Notifications。General 包含无项目任务默认目录（默认 `~/Documents/Cypheria`）、动态发现的本机文件打开应用、界面语言、菜单栏驻留、底部面板控件、终端位置、防止休眠和插件可用性。Composer 包含纯文本输入、上下文窗口用量、三种 Enter 发送模式和跟进消息行为。Popout Window 包含全局快捷键与默认独立聊天。Notifications 包含任务完成提醒模式、权限与问题提醒，以及内置 Default 和 Classic、None、从 macOS 发现的声音和自选声音文件。选中声音时立即试听；选中 None 时停止试听。插件总开关还会通过 Server 更新 Codex 进程级的 `plugins` 实验功能。

共享 Agent、model、integration、Web3 和 Server 行为属于 Cypheria Server 配置或数据库。UI 偏好不会写入 Codex 配置。

Git 设置页将本地 Codex Git 偏好保存在 Server 配置中，包括分支前缀、带租约的强制推送默认值、审查模式、PR 草稿和合并默认值、侧栏 PR 图标、工作树根目录及保留数量、上游刷新方式，以及提交、PR 和关注指令。工作树根目录在 Server 重启后生效。Review 面板遵循仅显示最后一轮的模式；创建和合并 PR 使用配置的默认值。

创建托管工作树后，Server 可按保留数量设置清理最多五个较旧的托管工作树。它会保护源 checkout、新建工作树、有 owner 的工作树、任何已保存线程使用的工作树、含未提交改动的工作树，以及最近十分钟创建或更新的工作树。被清理的工作树仍保留 Git 快照，可恢复。清理失败不会撤销成功的工作树创建。

对于新建或恢复的托管 Codex 线程，Server 会将配置的分支前缀和提交、PR 指令写入 Codex developer instructions。

## dApp 与 Web3 边界

每个 dApp origin 使用隔离 session partition 和受限 provider permissions。Electron 负责 `WebContents`、导航策略、弹窗、下载和注入边界。Provider request 转发到 Server Web3 API；签名和策略评估仍在特权 Server runtime 中。

## 跨平台要求

macOS、Windows 和 Linux 都是一等目标。平台专属代码留在 Electron main 或打包脚本中，并须保持：

- 原生 path、process 和 signal 行为；
- 窗口与 tray 约定；
- 代码签名和更新边界；
- 包括 `node-pty` 在内的原生模块重建；
- Server executable 发现和日志访问。

Sidebar 或会话行为变更必须进行交互测试和视觉评审。发布前的打包验证必须覆盖三个桌面平台。
