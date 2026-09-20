---
title: Web3
---

# Web3

Cypheria 将纯 Web3 领域类型与特权执行分离。`@cypheria/web3` 提供 `network`、`wallet`、`policy`、`provider` 模块。`apps/server/src/runtime` 负责持久化、凭证、vault 访问、策略评估、签名、dApp sessions 和审计。

## 所有权

客户端使用 `client.web3`。它们可以创建网络、管理钱包 metadata、提交签名意图、处理审批和操作 dApp session，但不能访问私钥、credential headers、vault files 或 provider processes。

Agent 和 Schedule 使用同一 Server 边界，创建 intent 而不是 signature。Electron 负责隔离的 dApp `WebContents`，并把受限 provider request 转发到 Server。

## Networks

Network definition 包含 chain identity、native currency、explorers、testnet 状态、verification metadata 和有序 RPC endpoints。Endpoint 声明 transport、display label、enablement、local-development allowance、可选 headers、health 和 revision。

Server 支持列出和创建网络，启用、禁用、删除和排序网络；也支持添加、探测、启用、禁用、删除和排序 endpoints。Revision 保护并发 mutation。Endpoint credential 与公开 endpoint view 分开存储。

远程 dApp origin 必须使用 HTTPS；开发时允许 loopback HTTP。使用前会校验 URL、redirect、chain identity 和 RPC response。

## Wallets

Wallet 可以生成、从 HD mnemonic 或 private key 导入，或作为 watch-only record 添加。一个 wallet 可以包含有序 accounts 和 chain accounts。Active context 选择 wallet、account、network、chain account 和 execution mode。

私密材料加密保存在 `$CYPHERIA_HOME/vault` 下，而不是普通 SQLite 表中。Server 提供 lock 和 unlock 操作，但不返回 secret。删除是显式破坏性操作；审计记录不得包含 mnemonic、private key 或明文 signing payload。

## Policies 与 approvals

每个 signing intent 记录 source（`agent`、`dapp` 或 `schedule`）、wallet mode、归一化 intent、payload hash、policy decision、matched policy、expiry、revision 和 approval 关联。策略评估返回：

- allow；
- deny；
- require human approval。

除非存在明确启用且精确允许该操作的 policy，否则自动签名关闭。Approval decision 使用乐观 revision，记录 reviewer，并会过期。Payload 改变会产生新 hash，不能复用旧 approval。

## 签名生命周期

```text
调用方 -> signing intent -> policy evaluation -> 可选 approval
      -> vault-backed signer -> provider submission -> audit record
```

Server 校验 active context 与 chain，只在签名操作期间解析 key，在特权 runtime 中签名，并清除敏感中间值。中断的签名或交易提交会被相应标记，绝不会在 Schedule 或 Server 恢复后自动重放。

## dApp provider

Provider 层支持受限 Ethereum 与 Solana sessions 以及通用 provider events。dApp session 把 origin 与允许的 accounts、networks、methods 和 expiry 绑定。Session 状态按 origin 隔离；disconnect、account change、chain change 和 permission update 都是显式事件。

Wallet provider request 会经过 Schema 校验并通过 policy 路由。dApp 不会获得 Server credential 或钱包实现的直接访问权。

## 审计

Audit record 包含 actor、source、event type、correlation ID、payload hash、脱敏 summary 和 timestamp。审计事件包括 network 与 wallet mutation、lock state、policy decision、approval outcome、signing attempt、Schedule 发起的 Web3 run 和交易结果。

审计数据以追加为主。脱敏在持久化和日志之前完成，而不是只在 UI 展示时处理。

## 安全不变量

- Renderer、localStorage、IndexedDB、日志或普通数据库字段中不得出现私钥。
- 未经 policy evaluation 不得签名。
- 不存在隐式 auto-sign policy。
- dApp session 不跨 origin 共享。
- 公开 network view 不包含秘密 endpoint header。
- 中断的签名或发送不得自动重放。
- Agent 或 plugin 不获得 raw signer。
