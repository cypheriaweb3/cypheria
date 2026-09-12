# @cypheria/relay

Cypheria 客户端与服务端共用的、传输无关的 relay 与端到端加密工具。relay 只转发不透明的
WebSocket 帧；X25519 用于建立共享密钥材料，方向隔离的 XSalsa20-Poly1305 子密钥用于认证并加密所有应用消息。
配对 offer 由 `@cypheria/protocol` 定义，Bearer token 永远不会发送给 relay。

本包有意不包含 Cloudflare 适配器或部署代码。
