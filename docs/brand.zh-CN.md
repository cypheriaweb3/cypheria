# Cypheria 品牌规范

Cypheria 在桌面产品、浏览器界面与项目传播中统一使用一个几何标志。标志由开放的环形 **C** 与四角星核组成：环形代表持续运转的 agent workflow，星核代表处于中心位置、由用户授权的动作。

## 核心资产

- `apps/desktop/renderer/src/assets/brand/cypheria-mark.svg` 是透明、单色标志的唯一母版。用于产品 UI、加载状态，以及周围表面已经提供对比度的布局。
- `apps/desktop/renderer/src/assets/brand/cypheria-app-icon.svg` 是生成后供产品消费的 SVG 应用图标与 favicon 母版，在规定的圆角方形底板上承载标志。
- `apps/desktop/resources/icons/` 保存生成的平台资产。PNG、ICO 与 ICNS 只用于平台兼容，不是可编辑母版。

SVG 是 source format。应修改单色标志，或修改 `generate-brand-icons.mjs` 中的应用图标规则，再重新生成；不得描摹生成后的 PNG，也不得通过修改平台衍生文件来制作新的品牌资产。

## 颜色

| Token | 色值 | 用途 |
| --- | --- | --- |
| Cypheria Ink | `#121117` | 应用图标底色与主要深色品牌表面 |
| Cypheria Paper | `#F7F7F8` | Ink 上的主要标志颜色 |
| Cypheria Violet | `#8B72FF` | 星核强调色与克制的品牌强调 |
| Monochrome Ink | `#000000` | 透明标志母版；UI 可以降低透明度，或在深色表面反相 |

应用图标始终组合使用 Ink、Paper 与 Violet。产品 UI 继续使用共享的语义化主题 token；Violet 是品牌强调色，不能替代 destructive、warning、success 等状态颜色。

## 几何与安全空间

- 保持标志的原始比例。不得旋转、倾斜、描边、裁切，也不得重新排列环形与星核。
- 单独使用标志时，四周安全空间至少为标志显示宽度的八分之一。
- 应用图标的 `276/1254` 底板圆角属于 SVG 资产。生成的操作系统图标会增加透明的视觉安全边距，使底板约占平台画布的 84%，从而与原生 Dock 和任务栏图标对齐。不得移除该边距，也不得增加额外边框或角标。
- 单色标志的最小 UI 尺寸为 24 CSS 像素。应用图标的对比度与间距针对 favicon 做过调整，可缩小到 16 像素。

## 产品用法

- 加载与安静状态使用低透明度的单色标志。如果旁边已经提供本地化的无障碍状态文案，标志本身应视为装饰图像。
- 应用窗口、Dock/任务栏、启动器与浏览器 favicon 使用应用图标。
- 浅色表面使用黑色单色标志；深色表面使用 Paper/白色版本，或反相单色资产。作为有意义的 UI 图形时，至少保持 3:1 对比度。
- 产品名称统一写作 **Cypheria**。界面文案不得使用全大写，也不得把标志与任意展示字体组合成未经批准的 wordmark。

## 生成与集成

修改标志或 approved icon rule 后，重新生成应用图标 SVG 与平台资产：

```sh
pnpm --filter @cypheria/desktop brand:generate
```

生成器会组合应用图标 SVG，并派生带视觉缩进的 1024px PNG、常用 Linux PNG 尺寸、Windows ICO 和 macOS ICNS。Electron main 在开发环境使用 PNG 作为窗口与 Dock 图标；TanStack Start 将不需要操作系统额外边距的满画布 SVG 作为页面 favicon。启用 desktop packaging 后，`apps/desktop/resources/icons/` 中对应的 ICNS、ICO 与 PNG 就是打包输入。

在 macOS 上，请通过 `pnpm --filter @cypheria/desktop dev` 启动开发应用（构建完成后也可使用 `dev:launch`）。启动器会创建一个被 Git 忽略并可复用的 `Cypheria.app` 开发壳，Bundle ID 为 `dev.cypheria.desktop.dev`，并写入 Cypheria 的 bundle 名称、可执行文件名和批准的 ICNS；正式版使用 `dev.cypheria.desktop`。直接运行 `electron .` 会绕过该开发壳，因此 macOS 会把进程识别为通用的 **Electron** 宿主。
