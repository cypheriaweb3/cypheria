# `@cypheria/relay`

> 状态：当前实现

用于 Cypheria 客户端和 Server 的传输无关配对、端到端加密与 relay URL helpers。

## 职责

该包执行 X25519 key agreement，并为 application frame 使用区分方向的 XSalsa20-Poly1305 keys。它校验 pairing offer 与 handshake state，限制握手前 queue，并把加密 channel 适配到共享 client transport。

Pairing offer 类型由 `@cypheria/protocol` 所有。Server Bearer token 绝不会发送给 relay。

## 边界

该包不包含部署、coordination、数据库、Agent、Electron 或产品状态代码。Go 数据平面位于 `apps/relay`，只转发不透明 frame。

参见 [Relay](../../docs/relay.zh-CN.md)。
