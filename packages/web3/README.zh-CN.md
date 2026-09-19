# `@cypheria/web3`

由 Cypheria Server 与特权 Desktop 边界共享的纯净、可测试 Web3 领域模块。

## 公开入口

- `@cypheria/web3/network`：chain identity、network 与 RPC schemas、catalog data、URL 和 conversion helpers。
- `@cypheria/web3/policy`：signing-policy schemas 与确定性 evaluation。
- `@cypheria/web3/wallet`：wallet、account、chain-account、capability、context 和 signing-intent models。
- `@cypheria/web3/provider`：dApp sessions、Ethereum 与 Solana bridges、permissions、events 和有界 transport schemas。

```ts
import { evaluateSigningPolicies } from "@cypheria/web3/policy"
import { createEthereumProvider } from "@cypheria/web3/provider"
```

## 依赖边界

该包不包含数据库或文件系统访问、secret custody、签名执行、RPC credential storage 或 service lifecycle。这些职责属于 `apps/server/src/runtime`。Provider transport 将已校验请求转发给 Server，绝不处理私钥。

生命周期与安全规则见 [Web3](../../docs/web3.zh-CN.md)。
