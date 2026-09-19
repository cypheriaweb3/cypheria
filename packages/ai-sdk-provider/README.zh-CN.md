# `@cypheria/ai-sdk-provider`

基于 Cypheria Threads 和 `@cypheria/client` 的浏览器安全 AI SDK language-model providers。

## 公开入口

```ts
import { createCodex } from "@cypheria/ai-sdk-provider/codex"
import { createClaude } from "@cypheria/ai-sdk-provider/claude"
import { createPi } from "@cypheria/ai-sdk-provider/pi"
import { createOpenCode } from "@cypheria/ai-sdk-provider/opencode"
import { createAcp } from "@cypheria/ai-sdk-provider/acp"

const model = createCodex({ client })("default")
```

每个 provider 默认绑定持久 Cypheria Thread。传入 `threadId` 可复用已有 Thread；选择 ephemeral mode 可在调用结束后删除新建 Thread。

## 行为

Provider 将 Canonical Timeline updates 转换为 AI SDK text、reasoning、tool、file、custom、error 和 finish stream parts。Abort 会取消对应 Server turn。Cypheria provider metadata 保留 Agent、model、原生 identifier、Thread identity 和受支持扩展数据。

持久 Server Timeline 仍是权威历史。Stream 是实时消费机制，不是第二套存储。

## 依赖边界

该包只依赖 `@cypheria/client`、`@cypheria/protocol` 和 AI SDK 公开类型，不能启动 Agent process、读取 harness 文件、打开数据库或导入 Server 内部实现。

参见 [Agent harnesses](../../docs/agent-harnesses.zh-CN.md) 和[协议](../../docs/protocol.zh-CN.md)。
