# `@cypheria/web3`

供 Cypheria Server 与桌面特权边界共享的纯 Web3 领域能力，不依赖 Electron。包提供四个明确的入口：

- `@cypheria/web3/network` 负责 canonical chain identity、network/RPC schema、catalog record 与 conversion helper。
- `@cypheria/web3/policy` 负责 signing-policy schema 与确定性求值。
- `@cypheria/web3/wallet` 负责 wallet、account、chain-account、capability 与 signing-intent model。
- `@cypheria/web3/provider` 负责 dApp session、provider bridge、permission 与有界 transport model。

这些模块只包含领域逻辑和可测试的协议实现。数据库和文件访问、密钥保管、签名执行、endpoint 生命周期与审计持久化属于 `apps/server`；服务迁移完成前可暂留在 Electron 特权边界。

## Provider 边界

Provider 模块实现：

- origin 规范化、持久 partition 命名和 session scope 验证；
- 符合 [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) 的 Ethereum provider，包括 `request`、`on`、`removeListener`、标准事件和结构化错误；
- 符合 [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) 的不可变 provider detail 与 announce/request discovery；
- Ethereum permission 与有界 JSON-RPC IPC envelopes，包括常用的免授权只读 RPC methods；
- 使用官方 base、feature、chain 和 registration packages 的 Solana [Wallet Standard](https://github.com/anza-xyz/wallet-standard/blob/master/WALLET.md) wallet；
- 用于 Solana message、transaction、public key、64-byte signature 和 signed transaction 的规范化、带大小限制的 base64 IPC envelopes；
- 按协议区分的持久化 permission records，以及带 scope 的 main-to-preload provider events。

`createEthereumProvider()` 返回 controller，其中 `provider` 是面向 dApp 的 EIP-1193 object，`emit()` 用来投递 wallet state changes。`createEip6963ProviderDetail()` 与 `announceEip6963Provider()` 实现多 provider discovery；由于 context-isolated JavaScript objects 必须安全地跨越 `contextBridge`，Electron preload 使用 main-world installer。

`createSolanaWallet()` 暴露 `standard:connect`、`standard:disconnect`、`standard:events`、`solana:signMessage`、`solana:signTransaction` 和 `solana:signAndSendTransaction`。在向 dApp 返回结果前，它会验证 account address/public-key 一致性、chain 与 feature scope、transaction versions、request scope、response ID 和批量输出数量。

特权服务可以在无需钱包权限的情况下转发公共只读 RPC methods，并对 account、wallet 与 signing methods 做权限控制；也可以实现 silent/interactive connection、持久化 origin permission、连接状态、经过 policy 的 signing intent、注入式执行与脱敏 audit event，而无需让此 package 接触私钥。

EIP-6963 与 Wallet Standard icons 仅允许 raster data URI。JSON-RPC depth、node count 与 string length 有明确上限；Solana messages、transactions、signatures、batches、account identifiers 和 response cardinality 都会在跨越 privileged boundary 前验证。

此 package 不处理私钥，也不直接签名。它的 transport 会把经过验证的请求转发给可信 Server 服务；permission、policy evaluation、signing execution 与 audit record 均由 Server 负责。
