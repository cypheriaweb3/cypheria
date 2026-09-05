# 插件与技能管理

## 基于截图的设计

以用户提供的八张 Codex 桌面截图为视觉依据，替代之前的文档缩略图。

- 目录：居中窄内容区、左对齐标题、圆角通栏搜索、已安装图标栏、公开/个人筛选、无边框双列分类条目。
- 未安装显示加号；已安装显示试用/管理/卸载菜单。悬停背景轻量，描述单行省略；启用开关放在设置页。
- 搜索时隐藏图标栏和分类，显示平铺结果；清空恢复目录；详情面包屑返回保留当前页内搜索。
- 技能采用前六项预览、可展开分组、作用域筛选与勾选状态。
- 详情使用面包屑、可选图标、安装/试用、可选分享链接、示例提示词、描述、分组应用、MCP、技能和信息；空分组不占位。
- `/settings/plugins` 使用现有设置外壳、单列条目、带数量页签和开关。菜单、弹窗、提示与开关复用共享 Base UI/shadcn 风格组件。

## 实现

Electron main 将生成的 App Server 协议映射为严格 Zod IPC 视图。已支持：`plugin/list`、`plugin/read`、`plugin/install`、`plugin/uninstall`、`config/value/write`（插件启用）、`skills/list`、`skills/config/write`、`marketplace/add`、`marketplace/upgrade`。

图标来自远程元数据，或由 main 转换 App Server 返回的本地图像路径（限定格式、最大 2 MB）。renderer 不选择这些路径。托管状态始终位于 `CODEX_HOME="$CYPHERIA_HOME/codex"`，不导入默认 home。

纯浏览器模式明确标为样例数据，只演示本地状态变化，不安装真实插件；Electron 使用真实数据。素材来源见插件资源目录 README。

创建插件/技能和立即试用只填入任务输入框，不自动提交。有应用安装地址才显示入口；已安装不等于已认证；缺少分享地址不生成假链接。

## 尚未完全对齐

应用和 MCP 已有独立管理页签。`app/list` 提供访问权限/本地启用状态，`app/installed` 提供有效启用和可调用状态。UI 区分可用、就绪、停用和受限；不把可访问直接称为已认证。运行快照失败时保留元数据，并提示运行状态未知。

连接操作由 main 查找已知应用，再在外部浏览器打开经过校验的 HTTP(S) 安装地址；返回窗口后刷新。MCP 清单结合分页 `mcpServerStatus/list` 与私有 `config/read` 投影保留停用服务器，不向 renderer 返回凭据、环境变量或命令。独立 MCP 开关只写入对应配置键并重载；插件内置 MCP 通过所属插件管理。

MCP OAuth 打开 `mcpServer/oauth/login` 返回的安全地址，监听 `mcpServer/oauthLogin/completed`、处理失败/超时并刷新；打开地址不代表登录成功。新增 MCP 支持可信 HTTP(S) 服务器，校验名称并拒绝覆盖同名配置，不提供任意 shell 命令或凭据输入。

市场发现按 App Server 生成类型中的类别分别查询，合并重复市场/插件时保留来源。目录只显示公开和个人两个页签。公开使用 `vertical`；个人内按需显示我创建的、与我共享的、本地市场和工作区分组。不把 Git/npm/remote 传输方式当作可见范围。部分来源失败时显示错误，不隐藏成功加载的来源。

技能标签是来源分组，不是主题分类。`user`、`system`、`admin` 分别显示为个人、系统和管理员安装。对 `repo`，Codex Desktop 取包含技能路径的最长工作区根目录末级名称；Cypheria 使用 `skills/list` 条目 cwd 推导等价的可用标签，因此会出现参考图中的 `ai`、`codex` 等名称。推荐来自桌面端独立的推荐技能目录，不从 `skills/list` 虚构；Cypheria 接入该来源后才显示。

本地市场移除须确认，并由主进程按精确名称重新查询。名称歧义、来源不存在/仅远程、加载错误或仍有已安装插件时阻止操作。用户须先明确卸载插件；这是 Cypheria 的保护策略，不代表 App Server 的限制。清理由 `marketplace/remove` 负责，不接受 renderer 指定路径删除文件。浏览器预览移除仅改变样例状态。

技能录制、高级 MCP 编辑及剩余视觉状态仍待实现；真实登录 Electron 授权尚未端到端验证。分类沿用服务端元数据，不虚构热门排名，目前不是完整 Codex 桌面功能复刻。

51 项 desktop 测试覆盖生命周期、来源分类、部分来源失败、市场移除保护、分页、停用 MCP、安全跳转、凭据排除、限定配置写入、重名拒绝与未完成表单。浏览器验证应用开关、搜索/空状态、MCP 详情/登录预览、添加校验、来源页签、移除确认及响应式页签。浏览器使用样例验证，未验证真实登录 Electron 安装。视觉结论见 `design-qa.md`。

## 官方资料

- [Plugins](https://learn.chatgpt.com/docs/plugins)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)

以 `packages/codex-bridge/src/generated` 的生成协议作为实现契约，不因文档成熟度标签屏蔽已有能力。
