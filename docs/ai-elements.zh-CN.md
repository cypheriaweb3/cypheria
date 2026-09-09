# AI Elements 集成与升级指南

Cypheria 将完整的 AI Elements registry 源码安装在
`packages/ui/src/components/ai-elements`。这些组件属于共享 UI 源码，而不是不透明的运行时依赖，
并通过 `@cypheria/ui/ai-elements/*` 导出。

## 当前集成

- Registry：`ai-elements@latest`
- 已安装组件：registry 中的全部组件（安装时共 48 个文件）
- 安装目录：`packages/ui/src/components/ai-elements`
- 共享基础组件：`packages/ui/src/components`，两处 registry 配置均使用 `base-nova`
- 包导出路径：`@cypheria/ui/ai-elements/<component>`
- 样式入口：`@cypheria/ui/styles.css`

AI Elements 的依赖归属于 `@cypheria/ui`。`pnpm-workspace.yaml` 中 workspace 级别的 React 类型
覆盖，会将自带 React 18 类型声明的依赖统一到项目使用的 React 19 类型版本。

48 个组件已基于 Nova 重新安装。AI Elements 使用统一 registry，没有独立的 Nova 变体：
控件继承本地 Nova 基础组件，组件自身的字号层级保持不变。仅重新安装不会替代下述兼容适配。

## 升级步骤

1. 从干净或已经审查过的工作树开始，以便审核生成内容的变化。
2. 在 `packages/ui` 目录执行：

   ```sh
   pnpm dlx ai-elements@latest
   ```

3. 安装 registry 中的全部组件。除非已经审查 Cypheria 的实现，否则不要覆盖现有的共享
   shadcn/Base UI 基础组件。
4. 检查 `packages/ui/package.json` 和 `pnpm-lock.yaml` 中的依赖变化。
5. 重新应用或确认下文列出的全部兼容性修改。
6. 格式化并验证 workspace：

   ```sh
   pnpm format
   pnpm --filter @cypheria/ui typecheck
   pnpm --filter @cypheria/desktop typecheck
   pnpm run ci
   pnpm build
   ```

不要直接使用 `--overwrite`。AI Elements 可能会请求已经存在于
`packages/ui/src/components` 的 shadcn 基础组件，覆盖它们可能改变整个桌面应用的 Base UI 行为。

有意全量重装时，在 `packages/ui` 中执行的等价 shadcn 命令为：

```sh
pnpm exec shadcn add https://elements.ai-sdk.dev/api/registry/all.json --yes --overwrite
```

执行前为已审查的共享基础组件保存快照；执行后对比并从快照补回本地适配（工作树有改动时，
不能直接恢复 HEAD），然后重新应用 AI Elements 适配。保留本地测试、主题样式表和桌面字号覆盖。
除 CI/build 外，还需运行 `pnpm --filter @cypheria/ui test` 及桌面测试。

## 兼容性修改

### NodeNext 导入

`@cypheria/ui` 使用 `moduleResolution: NodeNext`。AI Elements 文件之间的相对导入必须包含
输出后的 `.js` 扩展名，例如 `./code-block.js`、`./shimmer.js` 和 `./tool.js`。

### Base UI Hover Card

AI Elements 将 `openDelay` 和 `closeDelay` 建模为 Hover Card 根组件属性。Base UI 1.x 则将等价的
`delay` 和 `closeDelay` 放在 `PreviewCard.Trigger`。Cypheria 的共享 `HoverCard` 使用 context 保存根组件
上的延迟值，再由 `HoverCardTrigger` 转发给 Base UI。重新生成 Hover Card 使用方或共享基础组件后，
必须保留这一适配层。

### Base UI 事件与 render 组合

- 菜单和按钮事件类型应从本地 Base UI 封装组件推导，不要直接标注为 DOM `Event` 或普通 React
  鼠标事件。
- `CollapsibleTrigger` 的属性应传给 trigger 本身，不要展开到用于 `render` 的 `Button`，因为两者的
  Base UI render-state 类型不同。
- Base UI 的 `Dialog.onOpenChange` 有两个参数；更新受控状态时使用布尔值，同时完整转发两个参数。
- Tooltip 操作按钮和上下文预览触发器使用 `render` 组合，不能用 trigger 再包裹交互元素。
  保留键盘激活、禁用状态以及自定义上下文触发元素。

### Base UI 状态样式

使用 Base UI 属性替代 Radix 的 `data-state` 选择器：折叠根节点/面板提供 `data-open` /
`data-closed`，折叠触发器提供 `data-panel-open`，选中的标签提供 `data-active`。
箭头选择器需要匹配对应的 group（根节点或触发器）；触发器关闭时不存在 `data-panel-open`。
重新生成动画和标签样式时保留这些映射。

### AI SDK usage 字段

使用 AI SDK 7 时，从 `usage.outputTokenDetails.reasoningTokens` 读取推理 token，从
`usage.inputTokenDetails.cacheReadTokens` 读取缓存输入 token。工具描述可能是函数，只有字符串类型
才能直接渲染。

### 严格 TypeScript 检查

Cypheria 启用了 `noUncheckedIndexedAccess` 和 `noImplicitReturns`。正则捕获组、数组索引、语音识别
结果以及解析后的堆栈路径都必须保留检查或默认值。包含条件清理函数的 Effect，在没有清理函数的
路径上必须显式返回 `undefined`。

### 第三方 JSX 组件声明

在 NodeNext 与 Vite 下，`react-jsx-parser` 和 `ansi-to-react` 可能被解析为嵌套的 CommonJS 模块
对象，尽管最终的默认导出实际是 React 组件。应在渲染边界保留范围有限的 `resolveComponent`
运行时适配以解开这些默认导出；不能只做类型断言，也不要为此放宽整个包的 TypeScript 配置。

### XYFlow 样式

应从 `packages/ui/src/styles.css` 导入 `@xyflow/react/dist/style.css`，不要在 `canvas.tsx` 中导入。
NodeNext 无法为组件级副作用 CSS 导入找到声明，而共享样式表本来就是该包的公共样式入口。

### Desktop 输入框职责

AI Elements 负责 prompt-input 状态、附件校验、语音输入和提交管线，但 desktop workspace 自己负责
输入框布局与交互密度。当前布局已对照 ChatGPT Desktop 26.901.51231（build 8109）：会话内容与
composer 继承同一个 `--thread-content-max-width` 并使用相同的 toolbar padding，而不是分别维护固定宽度。
与应用包源码一致，Cypheria 不设置 Electron 的 `defaultFontSize` 和 `defaultMonospaceFontSize`，保留
Chromium 的 16 像素 rem 基线，并直接使用源码中的 `48rem`（768 像素）共享列。视觉字号继续由像素值 Tailwind token 独立控制，
例如 14 像素的 `--font-sans-size`；调整 UI 字号不得再缩放以 rem 表达的布局几何。无边框、20 像素圆角的 surface 使用 desktop composer 阴影；文本编辑器独占顶部一行；footer 显式划分左右控制组，
避免控件被可用宽度平均撑散。没有附件时不得为空的 attachment header 预留高度。编辑器随内容增高，
到 `25dvh` 后只有编辑器内部继续滚动。
输入框表面以及提交/停止状态使用 Tailwind 语义主题工具类（`card`、`foreground`、`primary` 及其成对的
foreground token）。不要在工作区样式表里重新加入字面量颜色；它会破坏自定义主题，并让明暗主题的
一致性变成偶然结果。
附件入口遵循所选模型由 App Server 声明的 input modalities。只有模型声明对应能力时，才接受图像或
provider 支持的音频媒体类型；视频、文档及其他文件类型不得表现为已接受，随后又从 turn input 中静默
丢弃。

应用包中的 desktop 把 prompt 草稿放在已挂载 composer 之外。它的
`composer-prompt-drafts-v2` store 会同时更新当前 client scope 与持久 conversation alias，并延迟
250 毫秒持久化。Cypheria 复刻这一生命周期：由 retained chat scope 持有当前 prompt 文本，并让
`PromptInputProvider` 将每次编辑及成功提交后的清空同步回 scope。新会话 key 与持久 thread ID 指向
同一份草稿，所以切换 route 或重启 renderer 后仍能恢复完全相同的未发送文本，而已提交 prompt 不会
再次出现。Cypheria 有意将 renderer 持久草稿限制为 100 个 alias；只有 20 个 retained chat scope
保留实时 `Chat` 对象，因此历史 thread 总量不会转化成无界 renderer 内存。与应用包 scope view state
一致，基于 blob 的附件也属于 retained chat scope：它们可带着有效预览 URL 跨 route 导航恢复，但仍是
session-only resource，绝不把失效 object URL 写入持久草稿。显式删除或成功提交会立即 revoke URL；
LRU 淘汰则 dispose 仍然存在的所有附件 URL。

粘贴路由遵循应用包中的编辑器逻辑，而不是 textarea 的浏览器默认行为。只有图片的剪贴板 payload 会
转换为附件；图片与真正独立的纯文本同时存在时，则保留文本粘贴路径，避免同一内容以两种形式重复加入。
长度达到 5,000 字符的纯文本会变成带首行预览的 `Pasted text.txt` 卡片；不超过 25,000 字符时，用户可
通过“在文本框中显示”将内容恢复到 textarea 当前选区。该卡片及其 blob URL 与其他草稿附件一样由 scope
持有。App Server v2 没有通用文件输入，因此 Cypheria 保留 desktop 交互，并在 privileged boundary
适配 payload：初次 `turn/start` 由 AI SDK provider 解码内联 `text/*` 字节，`turn/steer` 与
`thread/queue/add` 则由 Electron main 解码同一个经过校验的 data URL。这样模型会收到完整粘贴内容，
而不是静默丢弃的文档占位符。

用户 turn 采用本机 desktop 的紧凑气泡几何：气泡宽度最多占会话内容列的 77%，使用共享 secondary
surface、较大圆角和紧凑内边距。Assistant turn 的活动呈现刻意比上游 AI Elements `Task` 默认样式更扁平。
完成态折叠为一条低干扰的用时行与简短活动摘要；展开后的命令、推理和文件详情使用可测量、无高度动画的
collapsible。不要在 TanStack Virtual row 内重新启用 Task 的 slide/fade 高度动画；动画过程中的中间高度会与
row 测量竞争，导致阅读锚点漂移。

图片生成 item 与历史最终回复中的 Markdown 图片必须解析为同一份受管媒体。Renderer Markdown
只把 Codex `generated_images` 命名空间下的路径改写为
`cypheria://media/generated-images/...`；Electron main 再把该后缀解析到当前由 Cypheria 管理的
Codex home 下，校验路径仍在目录内且扩展名属于受支持的位图格式，然后通过特权协议提供内容。无关本地路径、
目录穿越和非图片文件仍不可访问。这样既能让冷恢复的图片回复正常显示，也不会授予 Markdown
任意读取文件系统的能力。

App Server 中 `delivery: "async"` 的 `agentMessage` 是 turn 中途问题，不是 final answer。应按
ChatGPT Desktop 的 projection 将其中的 `questions` 拆为独立问答面板，提供带序号的选项与自由输入，
并通过结构化 `send_user_message_question_reply` envelope steer 当前 turn。单选后等待 180 ms 再提交，
让用户能看见选中状态。已完成或历史 async message 只保留为低干扰 commentary，不再渲染服务端用于
fallback 的 Markdown 选项列表。固定在输入框上方的当前 turn 进度，只统计该 turn 内去重后的
`fileChange` path；较早 turn 的 workspace artifact 不得混入。恢复历史时，只有结构化回复中的 question
ID 确实命中同一 turn 的 async question，才不把它放入可见 user-message 序列；底层 item 仍保留在 turn
snapshot 中，用户手工输入的相似 markup 不会被误隐藏。

左侧控制组包含上下文、技能、项目和权限，右侧包含合并后的模型/推理菜单、听写，以及仅在需要时
出现的运行中 steer/queue 操作和圆形提交/停止按钮。模型与推理的 radio-group label 必须放在对应的
Base UI `Menu.RadioGroup` 内部；即使类型检查通过，把 `Menu.GroupLabel` 放在 group 外也会在运行时
抛错。没有文字和附件时提交按钮禁用，有有效 prompt 时显示箭头操作，生成过程中则明确切换到停止
状态。

滚动条颜色不能只依赖平台默认值。ChatGPT 保留 macOS overlay scrollbar 的原生几何形态，但使用透明
track 和低对比度 thumb，并在 hover 或主动滚动时增强。Cypheria 通过共享 `scrollbar-color` token 将该
行为应用到标准 overflow utility 与显式的 `cypheria-scrollbar` class。不要强制设置 WebKit scrollbar
宽度，否则会替换原生 overlay 行为并留下 ChatGPT Desktop 中不存在的永久 gutter。

### Conversation 滚动职责

桌面会话必须向 AI Elements `Conversation` 传入由 Cypheria 管理的外部 `instance`。
`Conversation` 仍会创建默认的 `use-stick-to-bottom` hook，但选择外部 instance 后，默认 hook 的
ref 不会挂到 DOM，因此其弹簧动画与 resize observer 不会生效。应保留 `initial={false}`、
`resize="instant"`，并在滚动视口禁用原生 CSS scroll anchoring。升级 AI Elements 时，不得让默认的
初始/尺寸变化平滑滚动重新接管 desktop workspace。

消息虚拟化与测量高度修正由 TanStack Virtual 负责。消息 ID 是稳定的 row key；启用末端锚定与
追加跟随；ResizeObserver 测量通过 animation frame 调度。Renderer 维护一个最多保留 20 个 thread
的滚动状态 LRU。每份状态记录原始 offset、距底部距离、是否位于底部、视口高度、第一个可见稳定
消息及其相对视口 offset，以及 TanStack 的已测量 row 快照。恢复过程在绘制前的 layout effect 中
运行：用户离开底部阅读时优先恢复稳定消息锚点；锚点不存在时回退为距底部距离；新 thread 或锁底
thread 则跟随真实底部。另一个即时 resize observer 覆盖虚拟列表测量根之外的布局变化，包括会话
padding 与延迟媒体布局；它只会在锁底状态下写入滚动位置，不会把正在阅读较早 turn 的用户拖走。

ChatGPT Desktop 26.901.51231（build 8109）在 renderer bundle 中定义 `ThreadScope`，使用
`key: clientThreadId` 与 `retain: { max: 20 }`；它的 route scope 也采用相同上限。Cypheria 通过另一个
renderer-owned chat scope cache 复刻该生命周期。每个 scope 拥有一个外部 AI SDK `Chat` 与一个 IPC
transport；新会话取得持久 App Server thread ID 后，会把该 ID 添加为初始 client key 的别名。LRU
最多保留 20 个未挂载且已结束的 scope。已挂载、`submitted` 或 `streaming` scope 会被固定，所以只有
同时活动的会话超过 20 个时才会暂时超过上限，完成后即回收。由此日常内存占用取决于最近会话状态，
而不是用户拥有的 thread 总数。

页面导航只会让 React view 从 retained scope 脱离，不会停止 turn 或销毁 AI SDK stream。稳定的
transport 从 scope 的可变 bindings 中读取最新 project、model、permission、resume 与完成回调。
成功完成 stream 时，会把完整 UI message 序列同步回已有的 thread-detail query entry，避免切走再回来
时短暂恢复成较旧的缓存 turn 列表。待处理 reverse request 则独立保存在 Electron main，并通过 typed
list operation 暴露，让重新挂载的 renderer 能恢复 approval/question 卡片，而不依赖只发送一次的事件。
Provider 的 reasoning chunk 也必须成对：空 reasoning item 不发 start 也不发 end，重复 completion
不得再发第二个 end。

每个 transport stream 在完成、失败、abort 或直接取消 stream 时，都移除 App Server event
subscription 与 `AbortSignal` listener。取消流程还会在中断 App Server 前清除 active request，因此
已结束的 scope 不会累积 per-stream listener closure。macOS 关闭主窗口时只隐藏窗口，不销毁 renderer；
重新激活应用会展示同一窗口，所以内存中的 chat scope 与滚动状态仍然存在。真正退出应用时会按预期
清除这些 session-only 状态。

显式点击 Stop 会发出中断 IPC，立即把仍在运行的 turn 与 item 生命周期投影为
`interrupted`/`completed`，将这个乐观结果同步到 thread query cache，再刷新 App Server 的持久状态。
Electron main 会先发送一次 `turn/interrupt`，再 abort AI SDK stream，避免并发重复中断。因此当前视图
无需切换 route 或冷重载，也会直接显示与重新读取后相同的停止状态。

## 升级审查清单

- 确认 registry 组件数量，并检查新增或删除的文件。
- 确认 `packages/ui/package.json` 仍然导出 `./ai-elements/*`。
- 确认现有共享基础组件没有被意外覆盖。
- 检查 Base UI 是否移动了 Preview Card 延迟属性或修改了事件签名。
- 检查 AI SDK 是否修改了 `LanguageModelUsage`、工具描述或 UI part 类型。
- 删除本地适配前，检查 `react-jsx-parser` 和 `ansi-to-react` 是否已修复 NodeNext 声明。
- 确认 desktop 仍传入外部 Conversation instance，且重新生成后的默认值不会恢复弹簧滚动或重复的
  resize anchoring。
- 确认 desktop 输入框仍保留分组 footer、`25dvh` 编辑器上限、合并的模型/推理菜单与提交/停止状态；
  并在 production build 中真实打开每个 Base UI 菜单。
- 确认共享 overflow surface 在亮色与暗色主题中都保留原生 overlay 几何、透明 track，以及 hover/主动
  滚动时增强的 scrollbar thumb。
- 冷打开一个图片生成会话，确认 item 卡片与最终回复中的 Markdown 图片都能显示，同时无关本地路径
  仍保持不可访问。
- 使用 `pnpm why @types/react -r` 检查 React 类型覆盖是否仍有必要。
- 在运行完整 CI 和构建命令前，先执行 UI 与桌面端 typecheck。

## 回归测试与来源说明

`packages/ui/src/components/ai-elements/compatibility.test.tsx` 移植了上游 AI Elements 测试套件
中的相关用例，并增加了针对 Base UI、NodeNext、严格数组索引、AI SDK 7 和安全 schema 路径渲染的
Cypheria 专用断言。上游测试使用 Apache-2.0 许可证；更新或扩展这些移植用例时，应保留测试文件中的
来源链接。

不要机械复制整套上游测试。上游测试可能假设不同的 shadcn 基础组件、AI SDK 版本或浏览器 mock。
应选择与变更组件相关的测试，按 Cypheria 的导入和 fixture 进行适配，再为每个本地兼容层补充断言。

`nova-compatibility.test.tsx` 额外覆盖单按钮 Tooltip 组合、键盘和禁用行为、上下文触发器、
Nova 选择器字号、输入提交/停止，以及 sandbox 折叠和标签状态样式。
