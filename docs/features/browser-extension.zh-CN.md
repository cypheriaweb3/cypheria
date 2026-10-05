---
title: 浏览器扩展
---

# 浏览器扩展

Cypheria 扩展是 `chrome` 后端的 `extension` 实现：它让 Cypheria Desktop 的 Agent 在用户自己的 Chromium 浏览器配置中工作。本页负责扩展、其原生消息宿主、它们连接的 Desktop 端点，以及三者之间的协议。Agent 能用这些浏览器做什么，以及 `chrome` 后端如何把它们限定在 Thread 范围内，见 [Computer Use](computer-use.zh-CN.md#外部浏览器)。

## 组成

| 部分 | 工作区 | 职责 |
| --- | --- | --- |
| 扩展 | `apps/browser-extension`（`@cypheria/browser-extension`） | 用 WXT 构建的 Manifest V3 service worker。它保持一个原生消息端口打开，列出标签页并管理分页分组，附加 `chrome.debugger`，转发 CDP 命令与事件，并报告下载。它导出 Desktop 使用的协议 Schema 和请求 peer。 |
| 原生宿主 | `apps/browser-extension-host`（Go） | 浏览器为每个扩展连接启动一个。它检查调用方，通过发现文件找到 Desktop，回答 `hello`，并在两个方向上转发其他所有消息。 |
| Desktop 端点 | `apps/desktop/main/src/browser-extension` | Electron main 的本地 socket、发现文件、宿主的安装与注册、每个已连接配置一个 session，以及在每个 session 转发的 CDP 上运行共享引擎的 `chrome` driver。 |

扩展保持精简。Thread 范围、标签页租约、turn 结束时的清理，以及所有页面行为（无障碍状态、输入、locator、截图、对话框、下载、Agent 指针和 `x-browser-agent` 请求头）都在 Electron main 中运行，与服务 `cdp` 实现的代码相同。扩展从不注入钱包 provider，也不读取浏览历史、书签或常用网站。没有侧边栏。

## 连接

```text
扩展 service worker ⇄ 原生消息（stdio）⇄ cypheria-browser-host ⇄ 本地 socket ⇄ Electron main
```

1. 扩展启动时、浏览器重启后，以及断开期间每次 alarm 触发时，service worker 调用 `chrome.runtime.connectNative("app.cypheria.browser_extension")`，并发送带有其 ID、版本和协议版本的 `hello`。打开的端口会让 service worker 保持运行。
2. 浏览器以调用方 origin 启动宿主。宿主拒绝扩展 ID 不在其编译内名单中的 origin，把自身 `bin/` 目录的上级目录解析为 `CYPHERIA_HOME`，并读取 `$CYPHERIA_HOME/run/browser-extension.json`。
3. 宿主连接该文件给出的端点，发送带有文件中的 token、origin 和扩展 hello 的 `connect`。Desktop 以常量时间比较 token，按允许的 ID 检查扩展 ID，比较协议版本，并回应自己的版本，或 `unauthorized`、`extension_update_required`、`app_update_required`。宿主以该结果回答 `hello`。
4. 没有 Desktop 时，宿主回答 `desktop_not_running` 并保持端口打开，每两秒查找一次 Desktop；连接成功时，或之后 Desktop 离开时，宿主发送 `desktopStatus`。版本或 token 错误会关闭端口，扩展以退避方式重试。
5. Desktop 向新连接请求 `getInfo`，并把该配置加入本设备的 `chrome` 浏览器。重新连接的配置会替换它之前的连接。

扩展未连接时，其工具栏图标显示 `!`；连接状态保存在 `chrome.storage.session` 中供诊断使用。

## 协议

每一段都传输同样的 JSON 消息：带 `id` 的请求、带 `result` 或 `error`（`code` 和 `message`）的响应，以及不带 `id` 的通知。浏览器在宿主的标准输入输出上把它们封装为 32 位小端长度加 UTF-8 JSON；宿主在 Desktop 的 socket 上使用相同的封装。发往浏览器的消息上限为 1 MB，宿主会以错误回应 Desktop 发来的更大的请求。消息发生不兼容变化时，`PROTOCOL_VERSION` 随之改变。Zod Schema 位于 `apps/browser-extension/src/protocol.ts`。

| 方向 | 消息 | 用途 |
| --- | --- | --- |
| 扩展 → 宿主 | `hello` | 版本；宿主以 Desktop 的版本或错误回答 |
| 宿主 → 扩展 | `desktopStatus` | Desktop 已连接或已离开 |
| 宿主 → Desktop | `connect` | token、origin 和扩展的 hello |
| Desktop → 扩展 | `getInfo` | 家族、扩展版本和该配置的实例 ID |
| Desktop → 扩展 | `listTabs` | 普通窗口中打开的标签页，含最后访问时间和分组标题，不含浏览器页面和无痕标签页 |
| Desktop → 扩展 | `openTab`、`nameGroup` | 在 Thread 的分页分组中打开后台标签页，分组建在最后聚焦的窗口；重命名该分组 |
| Desktop → 扩展 | `closeTab`、`attach`、`detach` | 关闭标签页；附加和分离 `chrome.debugger` |
| Desktop → 扩展 | `cdp` | 在已附加的标签页上执行一条 CDP 命令，需要时先附加 |
| 扩展 → Desktop | `cdpEvent`、`cdpDetached` | 已附加标签页的 CDP 事件；调试器离开某个标签页 |
| 扩展 → Desktop | `downloadChanged` | 下载开始、完成（带文件）或失败 |

Thread 的分页分组以 Thread ID 的哈希为键，因此扩展得不到 Thread 的任何信息。浏览器页面（`chrome://` 等浏览器 scheme 以及其他扩展的页面）和无痕标签页从不被列出或附加。

## Desktop 端点

Electron main 在 `$CYPHERIA_HOME/run/browser-extension.sock` 上监听 Unix socket，该目录仅所有者可访问；路径过长时改用私有临时目录；Windows 上监听由 home 派生的 named pipe。每次启动时它生成一个 token，并把端点、token、协议版本、Desktop 版本和进程 ID 原子地写入仅所有者可读的 `$CYPHERIA_HOME/run/browser-extension.json`。退出时，只有当该文件仍包含自己的 token 时才删除它，因为之后可能已有另一个 Desktop 启动。

启动时，Desktop 还会把自带的宿主安装到 `$CYPHERIA_HOME/bin/cypheria-browser-host`（只在内容变化时复制），并以 `app.cypheria.browser_extension` 注册它，只允许 Cypheria 扩展的 origin：

- macOS 和 Linux：在每个已存在的 Chromium 浏览器配置根目录（Chrome、Edge、Brave、Vivaldi、Opera、Chromium）的 `NativeMessagingHosts` 目录中写入 manifest。
- Windows：在 `$CYPHERIA_HOME/browser-extension/` 下写入 manifest，并为 Chrome、Edge、Brave、Chromium 和 Vivaldi 写入 `HKCU` 注册表项。

注册对每个浏览器是全局的，因此最后启动的 Desktop 拥有它。设置 → 通用 → 电脑操控会显示宿主是否已安装、哪些浏览器配置已连接，以及开发构建中已解压扩展的加载位置。

## 开发

`pnpm dev:desktop` 和 `pnpm --filter @cypheria/desktop dev` 会把扩展构建到 `apps/browser-extension/.output/chrome-mv3`，把宿主构建到 `apps/browser-extension-host/dist/<platform>-<arch>/`，Desktop 启动时安装宿主。每个浏览器配置只需加载一次扩展：打开浏览器的扩展程序页面，开启开发者模式，选择 **加载已解压的扩展程序**，然后选择该目录。manifest 的 `key` 固定了开发版扩展 ID，宿主和 Desktop 都接受它；商店构建会获得各自的 ID，发布时加入 `EXTENSION_IDS`。

```sh
pnpm --filter @cypheria/browser-extension build
pnpm --filter @cypheria/browser-extension test
pnpm --filter @cypheria/browser-extension-host build
pnpm --filter @cypheria/browser-extension-host check
pnpm --filter @cypheria/browser-extension-host build:all
```

单元测试让扩展的后端和原生端口对接一个模拟浏览器。Go 测试让宿主对接一个模拟 Desktop。`apps/desktop/main/src/browser-extension/extension.e2e.test.ts` 运行整条链路：Chromium for Testing 加载已解压的扩展，原生消息 manifest 位于它自己的用户数据目录中，真实宿主连接真实端点，`chrome` 后端打开、分组、认领并驱动标签页；缺少 Playwright 的 Chromium 或 Go 时跳过。
