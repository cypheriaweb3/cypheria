# 插件与技能管理

## 基于截图的设计

以用户提供的八张 Codex 桌面截图为视觉依据，替代之前的文档缩略图。

- 目录：居中窄内容区、左对齐标题、圆角通栏搜索、Public/OpenAI/Personal 筛选、无边框双列分类条目。
- 未安装显示加号；已安装显示试用/管理/卸载菜单。悬停背景轻量，描述单行省略；启用开关放在设置页。
- 搜索时隐藏图标栏和分类，显示平铺结果；清空恢复目录；详情面包屑返回保留当前页内搜索。
- 技能采用前六项预览、可展开分组、作用域筛选与勾选状态。
- 详情使用面包屑、可选图标、安装/试用、可选分享链接、示例提示词、描述、分组应用、MCP、技能和信息；空分组不占位。详情请求尚未完成时保留面包屑，用整页中性遮罩替换全部详情内容并居中显示 Cypheria 标志，避免切换插件时闪现旧插件信息。
- `/settings/plugins` 使用现有设置外壳、单列条目、带数量页签和开关。菜单、弹窗、提示与开关复用共享 Base UI/shadcn 风格组件。

## Provider 模型

Desktop 的 Plugins 区域在一条 Codex App Server 安装路径上组合两个 discovery/trust provider：

- **Cypheria Marketplace provider（待实现）**：读取 `apps/marketplace` 版本化 public API，获得分页发现、review state、advisory 和预期 catalog commit；Electron main 注册或升级 Cypheria 官方 GitHub repo marketplace，并通过 App Server 安装。
- **Codex App Server provider（已实现）**：负责 OpenAI 官方目录以及用户添加的 Git / 本地目录 marketplace，并通过捆绑 App Server 安装两者。

每个 Cypheria listing 都是来自 public open-source GitHub repository 的标准 ChatGPT/Codex plugin。生成的 Cypheria catalog 只允许由 commit SHA 固定的 `url` 与 `git-subdir` entry。Renderer model 必须携带 provider ID 和 source provenance。Search/category view 可以合并结果，但 detail、trust label、error 和 advisory 必须路由回所属 provider。Cypheria review badge 不适用于其他 App Server result。

## 已实现的 App Server 路径

Electron main 将生成的 App Server 协议映射为严格 Zod IPC 视图。已支持：`plugin/list`、`plugin/read`、`plugin/install`、`plugin/uninstall`、`config/value/write`（插件启用）、`skills/list`、`skills/config/write`、`marketplace/add`、`marketplace/upgrade`，以及带保护的 `marketplace/remove`。

Cypheria 将 `@openai/codex` 与生成协议固定到 `0.153.4`。

图标来自远程元数据，或由 main 转换 App Server 返回的本地图像路径（限定格式、最大 2 MB）。renderer 不选择这些路径。托管状态始终位于 `CODEX_HOME="$CYPHERIA_HOME/codex"`，不导入默认 home。

纯浏览器模式不再合成插件、技能、应用或 MCP 记录，而会提示该能力需要 Cypheria Desktop。Electron 始终通过 typed IPC 从 Cypheria 托管的 Codex App Server 读取真实数据。

插件目录还会读取 `account/read`。当 App Server 因当前会话使用 API Key 而拒绝远程目录请求时，UI 不再重复显示底层来源错误，而会说明模型访问仍处于连接状态、当前请求的远程目录需要 ChatGPT 身份验证。操作按钮跳转到 `/settings/connections?focus=codex`，并将既有 Codex 登录卡片滚动到视野内；API Key 已连接时，该卡片也会明确提示先退出再选择 ChatGPT 登录。未登录和 ChatGPT 会话失效场景使用各自文案；无关的来源错误仍正常展示。

创建插件/技能和立即试用只填入任务输入框，不自动提交。有应用安装地址才显示入口；已安装不等于已认证；缺少分享地址不生成假链接。

## 尚未完全对齐

应用和 MCP 已有独立管理页签。`app/list` 提供访问权限/本地启用状态，`app/installed` 提供有效启用和可调用状态。UI 区分可用、就绪、停用和受限；不把可访问直接称为已认证。运行快照失败时保留元数据，并提示运行状态未知。

连接操作由 main 查找已知应用，再在外部浏览器打开经过校验的 HTTP(S) 安装地址；返回窗口后刷新。MCP 清单结合分页 `mcpServerStatus/list` 与私有 `config/read` 投影保留停用服务器，不向 renderer 返回凭据、环境变量或命令。独立 MCP 开关只写入对应配置键并重载；插件内置 MCP 通过所属插件管理。

MCP OAuth 打开 `mcpServer/oauth/login` 返回的安全地址，监听 `mcpServer/oauthLogin/completed`、处理失败/超时并刷新；打开地址不代表登录成功。新增 MCP 支持可信 HTTP(S) 服务器，校验名称并拒绝覆盖同名配置，不提供任意 shell 命令或凭据输入。

App Server 没有独立的 `marketplace/list` method。`plugin/list` response 本身就是实时 marketplace inventory：`marketplaces[]` 中每条 record 都内嵌自己的 `plugins[]`。Cypheria 使用受信任的精确名称白名单分类：已知 OpenAI marketplace 名称归入 OpenAI；固定的 Cypheria 官方 marketplace identity `cypheria-curated` 归入 Public；其他 marketplace 一律归入 Personal，包括用户可控名称中含 `openai` 或 `cypheria` 的情况。Personal 按 marketplace 分组，标题优先使用 `interface.displayName`，否则回退到 App Server marketplace name。Cypheria provider 返回官方 record 前，Public 显示明确占位状态。

如果 App Server 返回 `openai-bundled` 与 `openai-primary-runtime`，它们也归入 OpenAI。它们可能由第一方安装配置，Cypheria 隔离的 Codex home 不保证存在；未返回属于正常空状态，不构成目录错误。

Codex Desktop 通过独立的 ChatGPT 登录态接口 `/ps/plugins/home` 获取当前目录分组，并通过 `/ps/plugin-categories/{category_slug}/plugins` 分页加载完整分组；它们不是 App Server method。`featuredPluginIds` 只是本地降级信号，不是当前 **Popular** 的成员清单。只能使用 App Server 数据时，Cypheria 把有序 `openai-curated-remote` marketplace 的前 50 项作为 Popular 首页，不合并其他 marketplace 的项目。如果缺少远程 marketplace，则回退到 `featuredPluginIds`。主题分组根据 `PluginInterface.category` 包含全部插件，即使同一插件已出现在 Popular；**Other** 始终放在最后。App Server `0.153.4` 既不提供发布时间，也不提供 New & Noteworthy 成员清单，因此 Cypheria 不推断新品。

技能标签是来源分组，不是主题分类。`user`、`system`、`admin` 分别显示为个人、系统和管理员安装。对 `repo`，Codex Desktop 取包含技能路径的最长工作区根目录末级名称；Cypheria 使用 `skills/list` 条目 cwd 推导等价的可用标签，因此会出现参考图中的 `ai`、`codex` 等名称。推荐来自桌面端独立的推荐技能目录，不从 `skills/list` 虚构；Cypheria 接入该来源后才显示。

Personal marketplace 移除须确认，并由主进程按精确名称重新查询。官方、歧义、不存在、无法解析、加载失败，或仍有已安装插件的 marketplace 不可移除。用户须先明确卸载这些插件。清理由 `marketplace/remove` 负责，不接受 renderer 指定路径删除文件。

Cypheria Marketplace discovery/trust provider、自动注册其 GitHub repo、技能录制、高级 MCP 编辑及剩余视觉状态仍待实现。已使用 ChatGPT 登录验证 Codex `0.153.4`：Cypheria 托管 home 返回 `openai-curated-remote`，第一方管理的默认 home 还会返回 bundled 与 primary-runtime marketplace。主题分类名沿用 App Server 元数据；在 App Server 提供目录分组前，Popular 使用上述有序兼容降级。

Desktop 测试覆盖生命周期、来源分类、部分来源失败、市场移除保护、分页、停用 MCP、安全跳转、凭据排除、限定配置写入、重名拒绝与未完成表单。真实登录目录和连接授权必须在 Electron 中检查；生产路由不再提供样例目录。视觉结论见 `design-qa.md`。

## 官方资料

- [Plugins](https://learn.chatgpt.com/docs/plugins)
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Cypheria Marketplace 设计](marketplace.zh-CN.md)

以 `packages/protocol/src/generated/codex` 的生成协议作为实现契约，不因文档成熟度标签屏蔽已有能力。
