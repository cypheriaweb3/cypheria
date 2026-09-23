---
title: 数据库
---

# 数据库

Cypheria 通过 Drizzle ORM 和本地 libSQL driver 使用 SQLite。`packages/db/src/schema/` 是可编辑 Schema 来源；`packages/db/drizzle/0000_initial.sql` 及其 snapshot 是当前生成迁移基线。

## 位置与所有权

默认数据库是 `$CYPHERIA_HOME/db/cypheria.sqlite`。只有 Server 会打开它。Desktop、CLI、Expo、Agents 和 plugins 使用 Cypheria 协议，绝不导入数据库 repositories。

每个连接都会启用 foreign keys。Server service 定义 transaction 边界，并在持久化 JSON 重新进入领域时进行校验。

## 表分组

| 领域 | 表 | 职责 |
| --- | --- | --- |
| Runtime | `runtime_metadata`, `settings`, `audit_logs`, `workspaces` | Runtime metadata、key/value settings、追加型 audit、workspace records |
| Agents | `agent_registry` | 用户选择的 Agent 成员关系、创建时间、安装、启用、版本和状态；原生 harness 会预置 |
| Projects 与 Threads | `projects`, `threads`, `project_items`, `sections`, `section_items` | 持久组织、排序、membership、archive 和 harness linkage |
| Thread 执行 | `thread_lifecycle_operations`, `thread_message_requests`, `thread_timeline_epochs`, `thread_timeline_rows` | 生命周期恢复、消息幂等 receipt 和只追加 Canonical Timeline |
| Schedules | `schedules`, `schedule_runs` | Definitions、next occurrence、leases 和 run history |
| Networks | `networks`, `network_rpc_endpoints`, `dapp_network_contexts` | Chain definitions、有序 endpoints、health 和 origin context |
| Wallets | `wallets`, `wallet_accounts`, `chain_accounts`, `wallet_hd_schemes`, `active_wallet_context` | 公开 wallet metadata 和 active selection |
| Signing | `signing_policies`, `signing_intents`, `signing_intent_claims`, `approval_requests` | Policy、intent、lease、approval 和 replay protection |
| Browser | `dapp_origins`, `dapp_permissions`, `solana_dapp_permissions` | Origin isolation 和受限 provider permission |

私钥、mnemonic、vault encryption key、decrypted signer 和秘密 endpoint header 不属于普通表数据。

## Project 与 Thread 约束

Cypheria UUIDv7 标识 Projects、Threads 和 Sections。Thread 拥有一个不可变 Agent；每个 Agent 至多对应一个 harness session linkage；可选 fork origin；Project 和 Section membership 相互独立。

`project_items` 让一个 Thread 最多属于一个 Project。`section_items` 在同一有序域中交错 Project 和 Thread，并让每个条目最多属于一个 Section。固定 Pinned Section 的稳定 ID 为 `01984de2-8f74-7c91-a3b2-5c5e937cf318`。

排序列在所属 scope 中非负且唯一。Membership move 和 compaction 在事务中执行，客户端不会观察到重复 position。

## Canonical Timeline

`thread_timeline_epochs` 保存每个 Thread 的 active epoch 和 next sequence。`thread_timeline_rows` 保存以 Thread、epoch、sequence 为键的不可变 canonical rows。Append 在一个事务中分配连续 sequence。Rehydration 或 history replacement 创建新 epoch 并原子替换 rows。内部可空字段 `agent_message_id` 把已提交的 canonical 用户 row 与 Agent 原生消息关联起来，但不会把该身份暴露到公开 Timeline 契约。

`thread_message_requests` 以 Thread 和 `client_message_id` 为键，保存稳定 request fingerprint，以及带已接受 turn ID 的 `pending` 或 `completed` receipt。Pending receipt 会跨重启保留，并在 Agent 投递结果不明确时阻止自动重放；completed receipt 则让相同重试返回原 turn。删除所属 Thread 时，这些 rows 会一并删除。

Server 读取 Timeline JSON 时使用 `ThreadTimelineRowSchema` 校验。Harness 原生 history 是适配输入，不是另一套客户端历史表。

## Schedules 与恢复

Schedule definition、next-run advancement、occurrence claim 和 run creation 通过事务协调。Claim 防止并发执行。重启时，遗留 running row 会先变为 interrupted，再恢复 active definitions。Web3 外部副作用不会自动重放。

Thread lifecycle operation 同样记录非原子的 harness 工作，使删除和 session transition 可在故障后校正。

## SQLite 约定

- 除非确实需要数字行身份，否则 ID 使用 `TEXT` UUID。
- Boolean 使用 integer 存储；enum-like value 使用命名 `CHECK` constraint。
- 时间默认使用规范 ISO UTC text；领域明确时可使用 Unix 秒。Project、Thread、Section 和 membership timestamp 使用 Unix 秒。
- 高精度 Web3 数量使用规范十进制 text，绝不使用 `REAL`。
- JSON text 只用于有边界的聚合，并在领域边界校验。
- 经常过滤、join、unique 或独立更新的属性应提升为列或子表。
- 并发可变 record 使用 revision 列实现 compare-and-swap。

## 事务

Transaction 保护排序变更、memberships、Timeline sequence 分配、Schedule claim、signing-intent claim、policy revision 和 approval decision。外部 Agent、RPC 或 wallet 操作不得占用长 SQLite transaction。应先持久化 intent 或 claim，再执行外部操作，最后记录终态结果。

## 迁移策略

产品尚未发布，因此有意只保留一个 baseline migration：`0000_initial.sql`，以及一个匹配 snapshot 和 journal entry。不探测、导入或升级旧应用数据。首次发布前，Schema 变更直接替换该 baseline。

首次公开发布后，migration 改为只追加：不得修改或删除已应用 migration。应从 Schema 生成并评审 SQL，同时测试空数据库创建和从上一发布 Schema 升级。

```sh
pnpm --filter @cypheria/db db:generate --name=<migration-name>
pnpm --filter @cypheria/db db:check
pnpm --filter @cypheria/db db:migrate
pnpm --filter @cypheria/db test
```

Schema files、SQL、snapshot 和 journal 必须一起提交。
