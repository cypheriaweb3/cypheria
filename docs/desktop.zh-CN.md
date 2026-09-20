# Desktop

`apps/desktop` 是 Cypheria 的主客户端，由 Electron main、preload 与 TanStack Start renderer 组成，保留紧凑、面向工作区的 Sidebar 和会话体验。它不与 Expo 共享应用 shell。

## 进程边界

- Electron main 负责窗口、应用生命周期、Server 管理、桌面设置、安全存储、更新、原生菜单、操作系统集成和隔离的 dApp browser views。
- Preload 为 Electron 专属能力暴露狭窄的类型化 IPC。
- TanStack renderer 通过 `@cypheria/client` 使用共享产品状态，通过 AI SDK providers 消费实时 Agent turns。
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

## Settings 导航

Settings 使用一个扁平化、虚拟化的导航列表。返回行、分组标题、普通设置项、可展开的 Agent harnesses 行，以及所有可见 Agent 子项共享一个滚动容器与一个 TanStack Virtual virtualizer。搜索框与主题 footer 留在容器外。展开、搜索和 registry 更新会重建扁平 row model；路由变化时会把 active item 滚动到可见区域。Agent 子项绝不创建嵌套滚动容器或第二个导航 virtualizer。

Agent harness 路由使用 `/settings/agent-harnesses/$agentId/$sectionId`。所选 Agent 拥有用于 installation、authentication、models 和发现型设置分类的第二级 section 菜单；窄屏时转换为选择器。右侧 panel 显示具体 section。Network proxy 位于 Agent header 上方，默认折叠，并在切换 Agent 或 section 时保留展开状态。Models 使用另一个固定高度虚拟列表，支持 provider 过滤和显式 Server 刷新。

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

共同体验包括草稿、附件、临时到持久 Thread 转换、每 Thread scope、流式输出、取消、重试、虚拟 Timeline、滚动锚点、位置恢复、未读、搜索、导航、reasoning、plans、tools、commands、diffs、terminals、approvals、artifacts 和故障恢复。

Harness 专属 UI 仅限判别 Timeline 扩展、header actions、model settings、permission details 和真实 harness capabilities。Codex 仍是保真参考，但 Claude、Pi、OpenCode 和 ACP 复用同一 shell，而不是复制整套 UI。

Canonical Timeline 历史通过 `@cypheria/client` 加载。AI SDK stream 提供响应迅速的实时更新，但不会成为第二个持久历史存储。

## Desktop 本地设置

Electron 在 `userData/desktop-settings.json` 保存本地偏好：

- 外观、语言、字体、密度和布局；
- 快捷键、声音、窗口边界和 panel 状态；
- Server 自动启动、executable 和首选端口；
- browser、更新、tray 和 OS integration 行为。

共享 Agent、model、integration、Web3 和 Server 行为属于 Cypheria Server 配置或数据库。UI 偏好不会写入 Codex 配置。

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
