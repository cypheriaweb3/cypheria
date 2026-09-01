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

HD 方案按 chain namespace 保存。V1 实现 EVM `eip155`、secp256k1 和 `m/44'/60'/0'/0/{index}`。Schema 可以表达未来 namespace，但尚未支持的方案必须验证失败。

## 公开数据持久化

SQLite 是钱包 metadata、生命周期、账户、地址、派生路径和 active context 的 source of truth：

```txt
wallets
wallet_accounts
chain_accounts
wallet_hd_schemes
active_wallet_context
```

普通列和 JSON 不得包含助记词或 entropy、BIP-39 passphrase、私钥、vault encryption key、解密 keystore 或序列化 local signer。`initializing`、`ready`、`error` 和 `deleting` 生命周期用于跨 SQLite 与文件系统边界恢复。

## Fingerprint

Fingerprint 有意用于查重，不是认证秘密。

- HD 钱包对包含 kind、curve 和固定 EVM probe path `m/44'/60'/0'/0/0` 标准化地址的版本化 canonical identity 做 hash。
- 单私钥与单观察钱包对 kind、namespace 和标准化地址做 hash。
- Group 容器使用随机稳定 identity，因为成员会变化；每个成员拥有用于查重的 account fingerprint。
- Kind 是 fingerprint 的一部分，因此允许将 HD 派生私钥作为独立钱包导入。

## 加密 Vault

每个包含秘密的钱包在 `$CYPHERIA_HOME/vault` 下拥有独立版本化文件。Private-key group 每个账户使用独立 encrypted entry，成员变化不会重写无关秘密。

Runtime 从 OS-backed key provider 获取随机 master key，并以 vault 和 entry ID 通过 HKDF 派生每 entry key。窄边界 ethers adapter 只负责编解码 Web3 Secret Storage JSON。账户派生、签名、RPC、交易序列化和地址处理均使用 viem。

Vault 先写同目录临时文件，sync 后 atomic rename。启动恢复绝不静默删除 vault 缺失的 ready 钱包。无引用 vault 文件先隔离，等待显式恢复。

## 解锁内存

常驻 runtime 可以在内存缓存解密秘密，但不得复制到 SQLite、browser storage、renderer state、日志、audit payload、错误、Codex context 或 worker。Lock 会丢弃缓存引用。JavaScript 无法承诺物理 secure zeroization，因此实现不得这样声称。

调用方只获得 `signMessage`、`signTypedData` 和 `signTransaction` 等不透明签名能力。任何公共 interface 都不得暴露 `privateKey`、`mnemonic` 或 `getKeystore`。

## 创建、导入与恢复

新生成 HD 钱包可在耗时加密期间显示为 `initializing`。只有 vault 完成 atomic persistence 且 SQLite 进入 `ready` 后才能使用。

导入钱包可能已经控制资金，因此 HD 和私钥导入必须在成功持久化 vault 后才报告成功。Watch 导入没有 vault 阶段。恢复流程协调 lifecycle state 和 vault 文件；vault 缺失时将已有钱包标记为 error，而不是删除记录。

## 签名

签名流程解析账户、验证 chain 和 address、让 intent 经过 policy 与 approval、在 runtime 内构建 viem account、验证其地址与持久化状态一致、执行签名、在可能时验证结果并追加 audit event。发送交易与仅签名交易是不同权限。秘密和敏感签名输入必须在所有 runtime boundary 中脱敏。
