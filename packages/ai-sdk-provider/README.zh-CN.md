# Cypheria AI SDK Provider

`@cypheria/ai-sdk-provider` 为 Codex、Claude、Pi、OpenCode 与 ACP agent 提供 AI SDK v4 language model。所有 provider 都是 browser-safe 的，只会把执行委托给已连接的 `@cypheria/client`，不会启动 agent 进程或读取本地 agent 配置。

```ts
import { createCodex } from "@cypheria/ai-sdk-provider/codex"

const codex = createCodex({ client })
const model = codex("default")
```

Provider 默认创建持久化 Cypheria Thread。设置 `threadMode: "ephemeral"` 会在调用结束后删除新建 Thread，也可以传入 `threadId` 绑定已有持久化 Thread。Canonical Timeline notification 会转换为 AI SDK 的 text、reasoning、tool、file、custom、error 与 finish stream part；provider provenance 保留在 `providerMetadata.cypheria` 中。
