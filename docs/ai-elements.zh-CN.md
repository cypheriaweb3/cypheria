# AI Elements 集成与升级指南

Cypheria 将完整的 AI Elements registry 源码安装在
`packages/ui/src/components/ai-elements`。这些组件属于共享 UI 源码，而不是不透明的运行时依赖，
并通过 `@cypheria/ui/ai-elements/*` 导出。

## 当前集成

- Registry：`ai-elements@latest`
- 已安装组件：registry 中的全部组件（安装时共 48 个文件）
- 安装目录：`packages/ui/src/components/ai-elements`
- 共享基础组件：`packages/ui/src/components`
- 包导出路径：`@cypheria/ui/ai-elements/<component>`
- 样式入口：`@cypheria/ui/styles.css`

AI Elements 的依赖归属于 `@cypheria/ui`。`pnpm-workspace.yaml` 中 workspace 级别的 React 类型
覆盖，会将自带 React 18 类型声明的依赖统一到项目使用的 React 19 类型版本。

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

### AI SDK usage 字段

使用 AI SDK 7 时，从 `usage.outputTokenDetails.reasoningTokens` 读取推理 token，从
`usage.inputTokenDetails.cacheReadTokens` 读取缓存输入 token。工具描述可能是函数，只有字符串类型
才能直接渲染。

### 严格 TypeScript 检查

Cypheria 启用了 `noUncheckedIndexedAccess` 和 `noImplicitReturns`。正则捕获组、数组索引、语音识别
结果以及解析后的堆栈路径都必须保留检查或默认值。包含条件清理函数的 Effect，在没有清理函数的
路径上必须显式返回 `undefined`。

### 第三方 JSX 组件声明

在 NodeNext 下，`react-jsx-parser` 和 `ansi-to-react` 可能被解析为模块对象，尽管它们的运行时默认
导出实际是 React 组件。应保留渲染边界处范围有限的 `ComponentType` 适配，不要为此放宽整个包的
TypeScript 配置。

### XYFlow 样式

应从 `packages/ui/src/styles.css` 导入 `@xyflow/react/dist/style.css`，不要在 `canvas.tsx` 中导入。
NodeNext 无法为组件级副作用 CSS 导入找到声明，而共享样式表本来就是该包的公共样式入口。

## 升级审查清单

- 确认 registry 组件数量，并检查新增或删除的文件。
- 确认 `packages/ui/package.json` 仍然导出 `./ai-elements/*`。
- 确认现有共享基础组件没有被意外覆盖。
- 检查 Base UI 是否移动了 Preview Card 延迟属性或修改了事件签名。
- 检查 AI SDK 是否修改了 `LanguageModelUsage`、工具描述或 UI part 类型。
- 删除本地适配前，检查 `react-jsx-parser` 和 `ansi-to-react` 是否已修复 NodeNext 声明。
- 使用 `pnpm why @types/react -r` 检查 React 类型覆盖是否仍有必要。
- 在运行完整 CI 和构建命令前，先执行 UI 与桌面端 typecheck。

## 回归测试与来源说明

`packages/ui/src/components/ai-elements/compatibility.test.tsx` 移植了上游 AI Elements 测试套件
中的相关用例，并增加了针对 Base UI、NodeNext、严格数组索引、AI SDK 7 和安全 schema 路径渲染的
Cypheria 专用断言。上游测试使用 Apache-2.0 许可证；更新或扩展这些移植用例时，应保留测试文件中的
来源链接。

不要机械复制整套上游测试。上游测试可能假设不同的 shadcn 基础组件、AI SDK 版本或浏览器 mock。
应选择与变更组件相关的测试，按 Cypheria 的导入和 fixture 进行适配，再为每个本地兼容层补充断言。
