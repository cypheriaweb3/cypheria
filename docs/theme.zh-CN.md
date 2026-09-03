# Theme System

Cypheria 以 Codex Desktop appearance model 作为用户可见配置的 source of truth，
再在运行时把这个较小的配置面投影到 Tailwind v4 和 shadcn CSS variables。用户不
直接编辑所有 shadcn tokens，而是在 Cypheria 管理的 Codex 配置
`$CYPHERIA_HOME/codex/config.toml` 中编辑 Codex-compatible appearance fields；
renderer 从这些字段派生更宽的 shadcn token set。

## Configuration Source

`[desktop]` section 保存 appearance-level preferences：

- `appearanceTheme`：`system`、`light` 或 `dark`。
- `appearanceLightCodeThemeId` 和 `appearanceDarkCodeThemeId`：light 和 dark
  下选中的 code theme preset ID。
- `appearanceDiffMarkerStyle`：`color` 或 `symbols`。
- `reduced-motion-preference`：`system`、`on` 或 `off`。
- `sansFontSize` 和 `codeFontSize`。
- `useFontSmoothing` 和 `usePointerCursors`。

`desktop.appearanceLightChromeTheme` 和 `desktop.appearanceDarkChromeTheme`
sections 保存可编辑的 light/dark chrome themes：

- `surface`：主要背景 surface。
- `ink`：主要前景文字颜色。
- `accent`：主 accent color。
- `accentSource`：`chatgpt` 或 `custom`。
- `contrast`：数字化对比度控制，用来派生 secondary surfaces、borders 和 washes。
- `opaqueWindows`：UI 中 translucent-sidebar preference 的反向值。
- `fonts`：UI/code font family strings，以及可选的结构化 `uiFace`/`codeFace`
  metadata。
- `semanticColors`：`diffAdded`、`diffRemoved` 和 `skill`。

Electron main 通过 typed IPC 负责读写这些 TOML keys。写入时会保留无关配置，只替换
受管理的 `[desktop]` appearance keys 和受管理的 chrome theme sections。

Cypheria 的 `AppearanceSettings` 使用简洁的应用层命名，同时 TOML adapter 保持 Codex
原始名称不变：

| `AppearanceSettings` | Codex config |
| --- | --- |
| `theme` | `appearanceTheme` |
| `lightThemeId` | `appearanceLightCodeThemeId` |
| `darkThemeId` | `appearanceDarkCodeThemeId` |
| `lightTheme` | `desktop.appearanceLightChromeTheme` |
| `darkTheme` | `desktop.appearanceDarkChromeTheme` |
| `uiFontSize` | `sansFontSize` |

## Runtime Flow

Electron main 在创建主窗口前读取 appearance config，并据此配置 native theme、窗口
初始背景、title-bar colors，以及 Chromium 默认的 UI/code font sizes。序列化后的
appearance 通过 bootstrap argument 传给 preload，再由 typed preload API 暴露。
Renderer 在 React hydration 前应用该 bootstrap value，并将其作为内存 Jotai atom 的
初始值，随后通过 IPC 刷新同一个 atom。Theme hooks 和 preferences hooks 都从这个
单一 appearance state 派生；不再使用 localStorage。

`appearanceTheme = "system"` 在 renderer 中通过 `prefers-color-scheme` 解析为实际
mode，并在系统偏好变化时更新。Tailwind 和 shadcn 只接收解析后的 mode：root
`.dark` class、`color-scheme`、CSS variables，以及少量 data attributes。

Codex-compatible preset themes 是不可变的内置 `codex-theme-v1` payload。选择某个
preset 时，会把 preset chrome theme 复制到可编辑的 light 或 dark TOML section，
并在 `[desktop]` 中记录对应的 code theme ID。之后用户修改的是 TOML-backed editable
theme，而不是 preset definition。

## shadcn Token Mapping

renderer 将每个 Codex chrome theme 映射为 shadcn-compatible CSS variables：

| Codex field | shadcn / Cypheria target |
| --- | --- |
| `surface` | 原样保留 `--background`；作为所有派生背景的基色 |
| `ink` | 原样保留 `--foreground`；作为中性背景和可读前景色的来源 |
| `accent` | 对比度调整后的 `--primary`、`--ring`、`--sidebar-primary`、`--sidebar-ring` |
| `surface` + `ink` + `contrast` | 独立的 card/popover、muted、secondary/accent、sidebar、sidebar-accent、border 和 input 角色 |
| `semanticColors.diffAdded` | `--diff-added` |
| `semanticColors.diffRemoved` | `--diff-removed`、`--destructive` |
| `semanticColors.skill` | `--skill` |
| `fonts.ui` | `--font-sans` |
| `fonts.code` | `--font-mono` |

持久化的六位 hex 颜色使用 sRGB 混色并输出不透明 hex token，让对比度计算和
渲染使用相同颜色。令 `t = clamp(contrast, 0, 100) / 100`。根据 surface 的相对
亮度选择配色分支（低于 0.179 为深色），即使自定义预设放入了相反模式的槽位。
默认 contrast 仍为浅色 45、深色 60。

| 角色 | 浅色 ink 百分比 | 深色 ink 百分比 |
| --- | --- | --- |
| card / popover | 0 | `4 + 3t` |
| muted | `2 + 3t` | `5 + 3t` |
| secondary / accent | `3 + 4t` | `7 + 4t` |
| sidebar | `1 + 2t` | `3 + 2t` |
| sidebar-accent，以 sidebar 为基底 | `3 + 3t` | `6 + 3t` |
| border | `6 + 5t` | `10 + 5t` |
| input | `10 + 7t` | `16 + 7t` |
| sidebar-border，以 sidebar 为基底 | `6 + 5t` | `10 + 5t` |

Primary 仍由强调色派生，通用交互背景改为中性色。Primary 文字/链接色以 background
和 sidebar 上的 4.5:1 为目标；填充 primary/destructive 的前景选择黑或白。
派生前景色、次要文字和 destructive 文字在检查的背景上以 4.5:1 为目标，焦点色
在组件透明度修饰之前以 3:1 为目标。不足时向黑白中更合适的端点混色，若无法同时
满足所有背景则回退至该端点。次要文字初始值为 ink 混入 `45 - 10t` 百分比 surface。
Diff 原色、源设置、导入导出载荷不变。这不代表全 UI 可访问性保证：源 background/ink
以及组件透明度修饰不变。UI mapper 的非 hex 输入保留 CSS 混色，但跳过数值对比度
检查。图表颜色、字体和圆角不变。

这个映射有意缩小 shadcn customization。shadcn 暴露很多彼此独立的 tokens，但
Cypheria 从 Codex 的更小 theme model 派生它们，让 UI 保持可预测，并兼容 Codex
theme import/export。

`opaqueWindows` 目前会持久化，并在 Appearance UI 中表现为 translucent-sidebar
toggle。完整的 native window material 变化需要 Electron chrome 支持，不能只靠
shadcn tokens 实现。

## Preferences Mapping

非 color token 的 appearance preferences 独立应用：

- `sansFontSize` 变为 `--font-sans-size`。
- `codeFontSize` 变为 `--font-mono-size`。
- `useFontSmoothing` 变为 `data-cypheria-font-smoothing`。
- `usePointerCursors` 变为 `data-cypheria-pointer-cursors`。
- `reduced-motion-preference` 在值为 `on` 或 `off` 时变为
  `data-cypheria-reduced-motion`；`system` 会移除 override。
- `appearanceDiffMarkerStyle` 由 diff UI 消费，用来选择 color-only markers 或
  `+/-` symbols。

## Font Mapping

字体处理保持和 Tailwind 默认 text-size scale 对齐。配置中的 UI font 暴露为
`--font-sans`，并以 `text-sm = --font-sans-size` 作为锚点；`text-xs` 到
`text-9xl` 的其它字号都从这个锚点按 Tailwind 默认比例缩放，默认 line-height
也使用 Tailwind 对应比例。

配置中的 code font 暴露为 `--font-mono`，并以
`font-mono text-xs = --font-mono-size` 作为锚点；`font-mono text-sm` 到
`font-mono text-9xl` 从 code 锚点按相同 Tailwind 字号和 line-height 比例缩放。

`font-sans` 和 `font-mono` 只负责 family、style、weight 和 stretch，因此组件代码
继续使用标准 Tailwind `text-*` 和 `leading-*` utilities。显式 `leading-*`
utilities 必须优先于默认 mono line-height。

用户选择具体 font face 时，TOML 除了保存 family string，还应该以 Codex-compatible
的结构在 `fonts.uiFace` 或 `fonts.codeFace` 中保存 face metadata。Code font 选择
在 UI 中应限制为 monospace families；UI font 可以使用 proportional families。
