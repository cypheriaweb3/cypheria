# 钱包管理

## 范围与边界

Cypheria V1 支持 `hd`、`private-key`、`private-key-group`、`watch` 和 `watch-group`。领域模型必须允许未来添加 hardware、external、embedded、multisig 和 account-abstraction provider，而不改变本地钱包存储契约。

- `@cypheria/wallet-core` 负责领域类型、验证、派生规则、fingerprint、renderer-safe projection 和 signer capability；不负责文件、数据库、Electron 或 OS credential。
- `@cypheria/db` 通过 Drizzle + libSQL 保存非秘密钱包状态。
- `@cypheria/runtime` 负责钱包编排、加密 vault、解锁内存、signer 构建、policy 路由和 audit 协调。
- Renderer、dApp 页面、Codex、SDK 调用方和 automation worker 永远不会收到助记词、私钥、vault key、解密 keystore 或暴露秘密的 signer object。

## 领域模型

```txt
Wallet
  WalletAccount
    ChainAccount
```

`Wallet` 是用户可见容器；`WalletAccount` 是逻辑派生或导入账户；`ChainAccount` 是某个 namespace 和 chain 上的公开身份。所有钱包类型的 index 都从零开始，不使用 pseudo index。

Wallet kind 与 provider 相互独立。V1 秘密钱包使用 `local-vault` provider，观察钱包使用 `read-only`。未来的硬件 HD 钱包可以复用 `hd` kind，并使用 `hardware` provider。

领域标识使用明确前缀（`wallet_`、`account_`、`chain_account_` 和 `vault_`）。所有 runtime boundary 都使用严格 Zod schema 验证。Renderer projection 使用嵌套 `{ wallet, accounts }` 结构，并用严格 schema 重新解析完整值，使意外附带的秘密字段被拒绝而不是被序列化。

HD 方案按 chain namespace 保存。V1 实现 EVM `eip155`、secp256k1 和 `m/44'/60'/0'/0/{index}`。Schema 可以表达未来 namespace，但尚未支持的方案必须验证失败。

## 公开数据持久化

SQLite 是钱包 metadata、生命周期、账户、地址、派生路径和 active context 的 source of truth。公开状态仓储持久化以下数据表：

```txt
wallets
wallet_accounts
chain_accounts
wallet_hd_schemes
active_wallet_context
```

普通列和 JSON 不得包含助记词或 entropy、BIP-39 passphrase、私钥、vault encryption key、解密 keystore 或序列化 local signer。`initializing`、`ready`、`error` 和 `deleting` 生命周期用于跨 SQLite 与文件系统边界恢复。

`@cypheria/db` 先使用 wallet-core 的严格 schema 验证完整钱包图，再通过原子 libSQL batch 写入。外键级联删除钱包；unique 与 check constraint 约束 fingerprint、名称、账户 index、钱包/provider 组合和已支持的 EVM 派生方案。恢复代码可按生命周期状态查询钱包，且无需加载任何 vault 秘密。

钱包展示顺序属于公开状态，以数值 position 保存在 wallet record 中。Runtime 只接受包含全部已持久化 wallet ID、且无重复项的完整排序，通过一次 database batch 更新位置；新建钱包会追加到现有顺序末尾。Desktop 管理页面将 `@tanstack/react-virtual` 与兼容 React 19 的 `@hello-pangea/dnd` 结合使用；后者延续了 Archmage 所用拖拽 API。

组钱包使用第二层虚拟列表展示 WalletAccount。HD、private-key-group 与 watch-group 行可以展开，账户身份不会被扁平化到一级钱包顺序中。账户行可独立拖拽；持久化仅重写其展示 index，HD 派生路径保持不变。Desktop 可以通过 typed IPC 派生新的 HD 账户。Runtime 从已持久化方案中选择下一个未使用路径，将加密 HD 源复制为绑定到账户的 vault entry，仅持久化公开账户图，并审计该变更。

## Fingerprint

Fingerprint 有意用于查重，不是认证秘密。

- HD 钱包对包含 kind、curve 和固定 EVM probe path `m/44'/60'/0'/0/0` 标准化地址的版本化 canonical identity 做 hash；其派生账户使用独立的 HD account fingerprint domain。
- 单私钥与单观察钱包对 kind、namespace 和标准化地址做 hash。
- Group 容器使用随机稳定 identity，因为成员会变化；每个成员拥有用于查重的 account fingerprint。
- Kind 是 fingerprint 的一部分，因此允许将 HD 派生私钥作为独立钱包导入。

## 加密 Vault

每个包含秘密的钱包在 `$CYPHERIA_HOME/vault` 下拥有独立版本化文件。Private-key group 每个账户使用独立 encrypted entry，成员变化不会重写无关秘密。

Runtime 从 OS-backed key provider 获取一个随机 256-bit master key。Desktop 使用 Electron `safeStorage` 保护其序列化值，并保存在 `$CYPHERIA_HOME/config/wallet-master-key.bin`；protector 不可用或 Linux 退化为 `basic_text` 时 fail closed。并发首次访问采用 single-flight。每个 256-bit entry key 使用 vault ID 和 entry ID 通过 HKDF-SHA256 派生。

窄边界 ethers adapter 将私钥和 HD mnemonic entropy 编解码为 Web3 Secret Storage JSON。由于该标准无法保留非空 BIP-39 passphrase，Cypheria 使用同一 entry key 的独立 subkey，将 passphrase 保存为经过认证的 AES-256-GCM 扩展密文。账户派生、签名、RPC、交易序列化和地址处理均使用 viem。

Vault 文件和受保护的 master-key blob 均使用仅 owner 可访问的权限。它们先写同目录临时文件，sync 后 atomic rename；删除先 atomic rename 为 tombstone。启动恢复会报告有引用但缺失的 vault，并隔离无引用、损坏及遗留临时文件，等待显式恢复；绝不静默删除 vault 缺失的 ready 钱包。

## 解锁内存

常驻 runtime 可以在内存缓存解密秘密，但不得复制到 SQLite、browser storage、renderer state、日志、audit payload、错误、Codex context 或 worker。Lock 会丢弃缓存引用。JavaScript 无法承诺物理 secure zeroization，因此实现不得这样声称。

Unlock 只返回标识与 entry kind。解密值保留在 internal controller 中，仅能由可信 runtime 钱包编排通过 scoped callback 使用。公开 vault 错误只包含稳定 code 和脱敏 message。

调用方只获得 `signMessage`、`signTypedData` 和 `signTransaction` 等不透明签名能力。任何公共 interface 都不得暴露 `privateKey`、`mnemonic` 或 `getKeystore`。

## 创建、导入与恢复

新生成 HD 钱包可在耗时加密期间显示为 `initializing`。只有 vault 完成 atomic persistence 且 SQLite 进入 `ready` 后才能使用。

导入钱包可能已经控制资金，因此 HD 和私钥导入先持久化 vault，再创建公开状态并报告成功；若公开状态写入失败，会补偿删除新建 vault。Watch 导入没有 vault 阶段。秘密导入均可提供 expected address；runtime 使用 viem 派生地址，并在持久化前拒绝不一致输入。

`@cypheria/runtime` 提供 wallet manager，用于生成和导入 HD 钱包、导入单个或分组私钥、添加单个或分组观察钱包、列出 renderer-safe view、重命名、删除以及选择 active context。查重会比较已持久化钱包和新分组内部的 wallet/account fingerprint。配置的多个 EVM chain ID 共享同一 EVM 地址，但各自保留独立 chain-account 记录。

Active context 保存唯一一组已选择的 wallet、wallet account、chain account 和 mode。持久化层会验证三个标识属于同一钱包图。只有 `ready` 钱包可被选择，观察钱包只允许 `read-only`；删除已选钱包时通过外键级联清除 context。变更操作写入不含秘密材料的脱敏 audit event。

恢复流程协调 lifecycle state 和 vault 文件；vault 缺失时将已有钱包标记为 error，而不是删除记录。删除本地钱包时先记录 `deleting`，原子删除 vault 后再移除公开状态；vault 删除失败则保留 `error` 记录供恢复。

## 签名

`@cypheria/runtime` 签发绑定到一个已持久化 wallet/account/chain reference 的不透明 capability。其方法接收完整且经过严格验证的 signing intent，而不是任意签名 payload。每次执行都会重新解析 ready 本地钱包状态，检查绑定的地址和链，要求 vault 已解锁，调用强制注入的 policy/approval authorizer，并在签名前原子 claim 已批准的 intent ID。签名服务不存在绕过路径，也不接受 `send-transaction`；签名与广播仍是不同权限。

生产环境的重放保护使用 libSQL 中的 `signing_intent_claims`。系统先授权、后 claim，因此等待人工审批的 intent 不会被提前消费，并可在作出决议后重试。批准后，系统会在访问秘密前使用 canonical SHA-256 payload hash claim intent ID，因此并发或后续复用在进程重启后仍会被拒绝。Vault 锁定同样在 claim 前检查，使同一 intent 可在用户明确解锁后重试。进程内 replay guard 仅作为显式 test 或隔离 runtime adapter 提供。

批准后，vault 只在 scoped callback 内按 wallet account ID 解析秘密。Runtime 重建 viem account、验证其地址与公开持久化状态一致、签署 message、EIP-712 typed data 或 transaction，并验证生成的签名或恢复出的交易发送方。Capability 只返回签名或序列化签名交易。

Policy decision、拒绝、签名成功和失败均使用 intent correlation ID 与 payload hash 写入 audit。Audit summary 只包含标识与结果类型，绝不包含私钥、助记词、message、typed data 或 transaction calldata。公开错误使用稳定的脱敏 code。
