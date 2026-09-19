# UI 系统

Cypheria Desktop 使用安静、紧凑、面向 panel 的视觉系统，适合长时间技术工作。既有 Sidebar 和会话工作区是保真要求最高的产品界面。本文负责视觉与交互规则；实现边界仍见 [Desktop](desktop.zh-CN.md)。

## 原则

- 信息层级优先于装饰。
- 使用低饱和度表面、克制边框和紧凑间距。
- 让会话、diff、terminal、approval、wallet、policy 和 browser context 等核心工作尽量无需额外导航即可看到。
- 优先使用成熟共享原语，而不是自制基础控件。
- 保持键盘与指针操作对等，并让 focus 清晰可见。
- 应用 UI 避免霓虹、光泽渐变和模板化 Web3 营销风格。

## 主题

语义 CSS variables 定义 background、foreground、panel、border、muted、accent、destructive、success、warning、focus 和 chart roles。组件使用语义角色，而不是直接使用品牌色。明暗模式都必须保持层级、对比度和状态区分。

Typography 使用清晰的 UI 字体栈，并为 code、command、path、address 和 hash 使用独立 monospace 字体栈。密度由共享 spacing 和 size tokens 控制，不使用零散组件覆盖。

持久 theme、locale、font 和 layout 偏好属于 Desktop 本地设置。共享产品状态不能依赖所选主题。

## 组件

`@cypheria/ui` 是可复用 primitives 和 AI Elements 的共享来源。常见 dialog、menu、popover、select、tabs、switch、slider、tooltip 和 focus management 优先使用 shadcn 风格复制组件与 Base UI primitives。

以下领域交互适合自定义组件：

- Agent 状态与兼容性；
- Timeline reasoning、plan、tool、command、diff、approval 和 artifact；
- wallet 与 account 切换；
- 签名复核和交易模拟；
- policy 编辑；
- dApp permission 和 browser 控件。

共享组件保持展示导向。数据获取和 Electron 访问留在应用层。

## AI Elements

AI Elements 提供可组合的 message、reasoning、tool、code、plan、attachment、prompt 和 streaming state 会话原语。Desktop 在既有会话 shell 内组合它们，不会替换已有导航、Thread scope、virtualization、scroll restoration 或 harness extensions。

Timeline renderer 接收 Canonical Timeline item。Harness renderer 只为判别 harness item 或确有额外行为的 metadata 注册。

## Sidebar 不变量

- 保持 Pinned、自定义 Sections、Projects 和 recents 的既有顺序与密度。
- 保持 nesting、expansion、pagination、selection、context menu、drag and drop、keyboard navigation、unread 和 running state。
- 不从视觉状态或 harness metadata 推断 membership。
- 乐观移动必须稳定；回滚同时恢复顺序和 membership。
- Loading 和 error placeholder 不应导致无关 row 跳动。

## 会话不变量

- 每个 Cypheria Thread 保留独立草稿和滚动位置。
- 临时到持久 Thread 转换不能丢失输入、附件或 focus。
- 流式更新进入稳定 item identity，并保持用户 scroll anchor。
- 用户离开实时边缘后不得强制滚动。
- 在操作发生位置展示 cancel、retry、pending interaction 和 failure recovery。
- 对所有 Agent 一致渲染通用 item type。
- Harness 专属控件保持局部作用域和清晰来源标识。

Virtualization 必须支持可变高度内容、增量历史加载、terminal output、展开的 reasoning 和大型 diff，且不能破坏恢复后的滚动位置。

## 无障碍与本地化

- 交互元素需要 accessible name、可见 focus 和正确 disabled state。
- Menu、dialog、listbox 和 drag alternative 必须可用键盘操作。
- 状态不能只依赖颜色表达。
- 在平台支持时尊重 reduced motion 和文字缩放。
- 英文和简体中文 UI 字符串使用 Lingui，并须在没有必需消息缺失的情况下编译。
- 布局要容纳更长翻译，不能截断关键操作。

## 视觉验证

修改 Sidebar、composer、Timeline、approval、diff、terminal、wallet 或 browser chrome 时，需要在两种主题下进行针对性交互测试和视觉评审。应覆盖常见窗口大小，以及 streaming、loading、empty、error 和长内容状态。

验收门槛是既有 Codex 体验无回退，并让 Claude、Pi、OpenCode 和 ACP 获得等价的共享行为。
