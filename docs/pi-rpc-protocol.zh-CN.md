# Pi RPC Protocol

Cypheria 固定使用 `@earendil-works/pi-coding-agent@0.85.1`，并把完整的
[`pi --mode rpc` protocol](https://pi.dev/docs/latest/rpc) 包装进现有 WebSocket 逻辑 `session`
message。服务端进程 adapter 目前刻意不实现。

## 边界

Pi 原生 protocol 是子进程 stdin/stdout 上的严格 JSONL。Cypheria 保留原生 command、response、
event 与 extension UI payload，但把通用 wire discriminator 换成可直接路由的逻辑 message type：

```text
Pi command { type: "get_state", id }
  <-> { type: "agent.pi.state.get.request", requestId }

Pi response { type: "response", command: "get_state", id, success, data/error }
  <-> { type: "agent.pi.state.get.response", payload: { requestId, result/error } }

Pi event { type: "message_update", ... }
  <-> { type: "agent.pi.message.update.notification", payload: <完整 Pi event> }
```

`AGENT_PI_RPC` 包含全部 33 组 command：prompt 与 queue、session state、model 与 thinking 选择、
queue mode、compaction 与 retry、bash execution，以及 session statistics、export、switch、fork、
clone、entries、tree、name、messages 和 commands。Registry key 是原生 Pi command name；每个定义
同时包含原生 command、Cypheria request/response type 和 Zod schema。通过映射后的
`satisfies Record<RpcCommand["type"], ...>` 检查，Pi 一旦增删 command，typecheck 会失败，直到
registry 完成适配。

Pi session event 会把完整 typed value 保留在 `payload`，同时以 23 个具体的顶层 notification
type 暴露其原生 event discriminator。`extension_error` 使用独立 notification。Consumer 因而可以
直接路由，同时不会丢失 provider data。

## Extension UI

Pi 把所有 extension UI operation 都发成 `extension_ui_request`，但只有 `select`、`confirm`、
`input` 和 `editor` 会等待输入。Cypheria 把这四种表示为 server-to-client request 与配对的
client-to-server response；`notify`、`setStatus`、`setWidget`、`setTitle` 和 `set_editor_text` 则是
server notification。原始 Pi object 保留在 `payload`；校验要求其中的 `id` 等于 Cypheria
`requestId`，method 也必须与具体 envelope 一致。

Protocol 为后续 server adapter 导出转换 helper：

- `unwrapPiRpcCommand()` 产生写入 Pi stdin 的原始 JSONL command；
- `wrapPiRpcResponse()` 把 Pi stdout response 转成配对逻辑 response；
- `wrapPiServerEvent()` 包装原生 event 与 extension UI output；
- `unwrapPiExtensionUIResponse()` 恢复写入 Pi stdin 的原始 response。

## Client

`@cypheria/client/pi` 导出不持有进程的 `RpcClient`，通过 `client(cypheria)` 绑定。其 command
method 与 Pi RPC client 对齐，也可以通过 `request()` 完整访问原始 command surface。
`onEvent()` 恢复原生 Pi event；`waitForIdle()`、`collectEvents()` 与 `promptAndWait()` 使用
`agent_settled` 判定结束，并会在 Cypheria transport 丢失时终止。阻塞式 extension UI 通过
`respondToExtensionUI()` 回答。

该门面不暴露上游 client 的 `start()`、`stop()`、`getStderr()`、executable path、environment 或
process signal。这些操作控制本地子进程，因此属于后续持有 `pi --mode rpc` 的 server adapter，
而不属于远程 protocol client。

官方 Pi type 可通过 type-only 入口 `@cypheria/protocol/pi-types` 使用。Pi runtime import 仍是
server 职责。
