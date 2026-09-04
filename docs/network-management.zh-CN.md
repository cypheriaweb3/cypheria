# Network 管理

## 目标

Cypheria 需要一套独立于钱包、可安全处理 dApp 来源请求、可供 automation 与 agent tools 使用，并能在不暴露凭据的前提下从多个 RPC endpoint 中选择连接的 network 机制。

设计将四个经常被错误合并的概念分开：

- **Chain identity**：说明正在访问哪条账本。
- **Network definition**：保存该链面向用户的元数据。
- **RPC endpoint**：描述访问该链的一种方式。
- **Network context**：为某个 workspace 或隔离 dApp origin 选择已配置的 network。

即使 network 被禁用或移除，wallet account 仍可保留 chain identity。Network 是连接配置，不拥有 wallet account 或 transaction history。

V1 实现 EVM 与 Solana identity。模型未来可以添加其他 namespace-specific variant，但不采用无类型的多链 metadata bag。

## Archmage-X 分析

Archmage-X 提供了值得参考的产品行为：

- Network 独立于 wallet 持久化。
- `(kind, chainId)` 唯一，并按 chain family 安装 preset。
- Chain-specific builder 将 preset 规范化为共享 record。
- Settings 支持 network 列表、搜索、添加、编辑、删除与排序。
- 添加 EVM RPC 时会探测可达性与 chain ID。
- dApp 请求添加或切换 network 时需要 consent。

Cypheria 应保留这些行为，但不直接复制其底层模型。Archmage-X 的设计存在以下问题：

- `info: any` 与反复类型断言无法强制 protocol invariant。
- `number | string` chain ID 缺少统一的跨协议 canonical identity。
- 顶层 record 与 protocol-specific `info` 重复保存 identity。
- 持久化的派生 search string 可能过期。
- 只有某个 family 为空时才 seed preset，难以协调后续 catalog 更新。
- RPC routing 通常直接选择第一个 URL，没有明确的 health、failover、stickiness 或 retry policy。
- 全局 active network 无法为 dApp 提供 origin isolation。
- 删除 network 会级联删除 chain account 与 transaction data，混淆连接配置和持久历史。
- 可变 nested metadata 和可编辑 chain identity 使引用完整性脆弱。

## Package 边界

### `@cypheria/network-core`

新增一个与 Electron 无关的领域包，负责：

- chain identity 与 canonical chain-key schema；
- 严格的 EVM 与 Solana network-definition schema；
- RPC endpoint、explorer、source 与公开 projection schema；
- bundled catalog entry type 与 reconciliation input；
- protocol boundary conversion helper；
- URL normalization 与非 I/O validation。

它不负责 database、网络请求、Electron、credential、wallet state 或 dApp approval。

### 其他 packages

- `@cypheria/wallet-core` 从 `@cypheria/network-core` 导入 chain identity primitive。`ChainAccount` 记录 identity、address 与 derivation 信息，但不拥有 RPC 配置。现有 `ChainDefinition` 与 `RpcEndpoint` 类型移出 wallet-core。
- `@cypheria/db` 持久化 network、endpoint、排序、revision 和 active context，不在普通列中保存受保护的连接材料。
- `@cypheria/runtime` 负责 `NetworkManager`、endpoint probe、RPC routing、health state、credential resolution、audit，以及与 wallet 和 dApp 的协调。
- `@cypheria/wallet-provider` 继续作为 protocol surface，在边界转换 EIP-1193 hex chain ID 与 Solana Wallet Standard identifier，但不选择 endpoint。
- Desktop main 管理受保护的 endpoint credential，只通过 typed IPC 向 renderer 暴露脱敏 projection。
- CLI 与 SDK 直接使用相同 runtime services，不依赖 desktop internals。

## 领域模型

### Chain identity

Chain identity 不可变，并按 protocol 区分：

```ts
type ChainIdentity =
  | {
      namespace: "eip155"
      reference: `${number}`
    }
  | {
      namespace: "solana"
      reference: string
    }

type ChainKey = `${ChainIdentity["namespace"]}:${string}`
```

EVM 的 `reference` 是正 safe-integer chain ID 的 canonical decimal 形式，不允许前导零。Protocol adapter 将其转换为或解析自 EIP-1193 hexadecimal quantity。Solana adapter 将其转换为或解析自 Wallet Standard `solana:<reference>` identifier。

持久化使用独立的 `namespace` 和 `reference` 列并添加 unique constraint。`toChainKey()` 产生 policy、automation、permission 与 event envelope 使用的唯一字符串 key，取代当前 EVM number 与 protocol-prefixed string 混用的状态。

### Network definition

```ts
type NetworkDefinition = {
  id: NetworkId
  chain: ChainIdentity
  name: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  explorers: readonly NetworkExplorer[]
  testnet: boolean
  source: "builtin" | "custom"
  catalogKey?: string
  enabled: boolean
  position: number
  revision: number
  createdAt: string
  updatedAt: string
}
```

`id` 是 opaque stable identifier。`(namespace, reference)` 唯一，创建后不可修改。改变 chain identity 必须添加另一个 network，从而避免静默改变已有 permission 或 active context 的目标。

Built-in metadata 由 catalog 管理。用户可以启用、禁用、排序 built-in，并添加 custom endpoint，但不能修改 catalog identity。Custom network 可通过 compare-and-swap revision 检查修改显示 metadata。

Explorer definition 只包含 HTTPS base URL 与 namespace-specific path template。Runtime helper 负责生成 account、transaction 与 token URL；调用方不会直接把不可信 identifier 拼接进 URL。

### RPC endpoints

RPC endpoint 是独立、有序的 record，而不是嵌入 network metadata 的字符串：

```ts
type RpcEndpoint = {
  id: RpcEndpointId
  networkId: NetworkId
  label: string
  transport: "http" | "websocket"
  connection:
    | { kind: "public"; url: string }
    | { kind: "protected"; displayUrl: string; credentialRef: string }
  source: "builtin" | "custom"
  enabled: boolean
  position: number
  revision: number
  createdAt: string
  updatedAt: string
}
```

包含 API key、authorization header、userinfo、敏感 query parameter 或秘密 path component 的连接材料，通过 OS-backed protector 加密保存在 `$CYPHERIA_HOME/config/network-credentials/`。SQLite 只保存 `credentialRef` 与脱敏 `displayUrl`。Renderer、dApp 页面、Codex、automation definition、日志和 audit payload 永远不会收到解析后的秘密。

Runtime-only health data 不是 authoritative configuration：

```ts
type RpcEndpointHealth = {
  state: "unknown" | "healthy" | "degraded" | "cooldown"
  observedChainKey?: ChainKey
  latencyMs?: number
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
}
```

Health 可以缓存在 `$CYPHERIA_HOME/cache`，但必须可随时丢弃。

## Bundled Catalog

Cypheria 内置一组与 viem chain metadata 兼容、经过审核的精简 catalog，以及经过审核的 Solana definition。V1 启动时不从远程 chain registry 拉取并信任配置。

每个 built-in entry 都有稳定 `catalogKey` 与 catalog version。启动 reconciliation：

1. 插入缺失的 built-in definition 和 endpoint。
2. 更新 catalog-owned metadata 与 public endpoint。
3. 保留用户的 enabled state、排序、endpoint preference 和 custom endpoint。
4. 对已从 catalog 移除的 entry 标记 deprecated 并禁用，而不是删除持久引用。

搜索文本在查询时根据当前规范化字段计算，不作为另一份 source of truth 持久化。

## 持久化

数据库新增：

```txt
networks
network_rpc_endpoints
dapp_network_contexts
```

`networks` 强制 `(namespace, reference)` 唯一、position 非负、revision 为正、source/catalog 一致，并验证 native-currency metadata。`network_rpc_endpoints` 属于一个 network，仅当 custom network 被永久移除时才允许级联删除。Endpoint position 在所属 network 内唯一。

`dapp_network_contexts` 为每个 `(origin, protocol)` 独立保存选中的 network，因此同一页面中的 Ethereum 与 Solana provider 不会互相覆盖选择。

`active_wallet_context` 增加 `network_id`。持久化层验证所选 network chain identity 与所选 `ChainAccount` 一致。禁用 network 会使该 context 无法执行 RPC，但不会删除 wallet selection。

Wallet chain account 保留 chain identity 列，不建立指向 `networks` 的 cascade foreign key。移除连接配置不得删除 account、policy、signing intent、transaction record 或 audit history。Active context reference 会被显式清除或拒绝，历史 record 保留其 chain key。

Built-in network 只能禁用。Custom network 默认也先禁用，永久移除必须经过独立确认。永久移除会删除其 endpoint、受保护 credential 与可丢弃 health state；清除 workspace/dApp selection；撤销绑定到该配置的 origin grant；暂停受影响的 automation；并让待处理的 RPC-dependent work 以稳定的 unavailable error 失败。Policy 与历史 record 继续以 chain identity 为键，但在没有匹配的 enabled network 时不可执行。重新添加同一条链绝不会静默恢复 dApp grant 或 automation execution。

## Runtime Services

### Network manager

`NetworkManager` 提供严格操作，用于：

- reconcile bundled catalog；
- list、inspect、add、update、disable、reorder 与 remove network；
- add、update、enable、reorder、probe 与 remove RPC endpoint；
- 按 `NetworkId`、`ChainIdentity` 或 `ChainKey` 解析 network；
- 选择 workspace 与 origin-scoped network context；
- 返回脱敏且 renderer-safe 的 projection。

所有 mutation 使用 revision，防止过期 UI 或并发 automation 静默覆盖变更。Network/endpoint 变更、dApp add/switch decision 与 credential 变更都会写入脱敏 audit event。常规 health probe 不刷屏 audit log。

### RPC router

`RpcRouter` 接收可信 chain identity 与用途：

```ts
type RpcPurpose = "read" | "simulate" | "broadcast" | "subscribe"
```

Routing 规则：

- 仅解析已启用且 probe chain identity 匹配的 network 与 endpoint。
- 优先使用用户排序，再参考当前 health；同一 operation 不随机分散到不同节点。
- 对需要一致性的 request sequence 固定使用同一 endpoint。
- 仅在 transport error、timeout、HTTP 429 与选定 5xx 上重试幂等 read。
- 不对确定性 JSON-RPC error 进行 failover。
- Broadcast 收到模糊响应后不自动重试或 failover；若已知 transaction hash，则随 indeterminate result 返回。
- WebSocket endpoint 只用于 subscription；只有调用方明确允许时才 fallback 到 polling。
- 强制 bounded timeout、response size、concurrency 与 redirect policy。

V1 不需要 quorum read、weighted load balancing 或复杂 score persistence。

## Endpoint 验证与安全

添加或编辑 endpoint 分两阶段：先本地验证，再由 runtime probe。

EVM probe 调用 `eth_chainId` 和 `eth_blockNumber` 等轻量 read，observed chain ID 必须与目标 chain identity 完全一致。Solana probe 获取 version 与 genesis/cluster identity，并与选中的 Wallet Standard chain definition 核对。

Custom RPC access 是 SSRF boundary，因为请求来自 privileged local process：

- 远程 endpoint 必须使用 `https:` 或 `wss:`。
- 只有用户显式添加的 development endpoint 才允许 loopback `http:` 或 `ws:`。
- dApp 来源的 add-network request 不得添加 loopback、private、link-local、multicast 或 cloud-metadata destination。
- 连接时检查 DNS resolution，降低 rebinding 风险。
- Probe 与 RPC request 禁止 redirect。
- dApp 不能提供 header、credential、TLS option 或 proxy configuration。
- URL 与 header 在日志和 audit 前必须脱敏。

dApp request 的 probe 失败不能被静默绕过。用户创建的 endpoint 可在明确警告后以 disabled 状态保存，但成功完成 identity probe 前不能路由流量。

## Wallet、Policy 与 Automation 集成

- `ChainAccount` 绑定 address 与 `ChainIdentity`，不绑定 RPC endpoint。
- Workspace active context 绑定 wallet、wallet account、chain account、network 与 policy mode，chain identity 必须一致。
- Signing intent 与 policy 使用 `ChainKey`；network 或 endpoint ID 永远不作为 authorization identity。
- Simulation 与 fee estimation 根据 intent chain key 通过 `RpcRouter` 解析。
- Automation definition 可以选择允许的 chain key，但不能选择受保护 credential 或绕过 network policy。
- 禁用 network 后，新的 RPC-dependent work 返回稳定 `NETWORK_DISABLED` error，同时保留 signing intent 与 audit data。

## dApp Provider 集成

每个隔离 origin 都有自己的 provider network context。

Ethereum：

- `eth_chainId` 返回该 origin session 选中的 EVM network。
- Public read-only RPC 只通过该可信选择转发。
- `wallet_switchEthereumChain` 解析请求的 hex ID，要求目标是已配置并启用的 network，取得用户 consent，只更新该 origin，然后向该 dApp 发出 `chainChanged`。
- `wallet_addEthereumChain` 严格验证 EIP-3085 input，probe 每个候选 RPC URL，要求用户 consent，并创建 custom network 或向已有 identity 提议添加 endpoint；绝不静默覆盖已有 metadata。

Solana connect 与 signing request 必须同时匹配 origin 选中的 Solana network 与 account 声明的 Wallet Standard chain。切换一个 protocol 不影响另一个 protocol。

Desktop workspace selection 与 dApp selection 相互独立。用户可以为某个 dApp session 显式启用 “follow workspace network”，但它是可撤销的 opt-in，而不是隐式全局状态。

## Desktop 体验

Network 页面提供：

- namespace、enabled/testnet 与搜索过滤；
- built-in/custom 和 enabled/disabled badge；
- network 与 endpoint 拖拽排序；
- 带实时 chain-identity probe 的 add/edit flow；
- endpoint health、last success、latency 与脱敏 URL；
- 显式 primary endpoint 与有序 fallback；
- built-in 使用 disable，custom network 使用受保护 delete；
- 对 protected credential、local development endpoint 与 dApp-proposed network 给出清晰警告。

Approval 页面在 add/switch approval 前展示 requesting origin、requested chain identity、current chain、metadata difference、全部脱敏 RPC host 与 probe result。

## Failure Semantics

Runtime 暴露稳定且脱敏的 error：

- `NETWORK_NOT_FOUND`
- `NETWORK_DISABLED`
- `NETWORK_IDENTITY_MISMATCH`
- `RPC_ENDPOINT_UNAVAILABLE`
- `RPC_REQUEST_TIMEOUT`
- `RPC_BROADCAST_INDETERMINATE`
- `RPC_DESTINATION_BLOCKED`
- `NETWORK_REVISION_CONFLICT`

Error 永远不包含 endpoint credential 或原始 authorization header。

## V1 不包含

- Remote registry 自动导入或静默 catalog update。
- Cosmos、Bitcoin、Starknet、Aptos、Sui 等其他 namespace implementation。
- Quorum RPC、archive-node capability discovery、weighted balancing 或付费 provider billing logic。
- Network configuration 或 credential 的 cloud sync。
- 因 network definition 被移除而删除 wallet history。
- 允许 dApp 选择 filesystem path、header、credential 或 unrestricted RPC destination。

## 实施顺序

1. 添加 `@cypheria/network-core`、严格 chain/network/endpoint schema、conversion helper 与精简 bundled catalog。
2. 添加 database table、catalog reconciliation、repository、protected credential storage 与 migration test。
3. 添加 runtime `NetworkManager`、endpoint probe、health tracking 与 purpose-aware `RpcRouter`。
4. 将 wallet-core、policy、automation、permission 与 active context 迁移到 canonical chain identity。
5. 通过 origin-scoped network context 路由 Ethereum 与 Solana provider request，并实现 add/switch approval flow。
6. 添加 typed desktop IPC 与 network-management UI。

每一步都应可独立测试，并作为一个可审查的 todo item 完成。
