# Schedules

> 状态：当前实现

Schedule 是 Server 所有的持久任务。Desktop 和 CLI 只通过 `client.schedules` 管理；任何客户端 timer 都不是权威来源。

## Cadence

支持三种 cadence：

- `once`：在 ISO 时间戳执行；
- `interval`：最短一秒的固定周期；
- `cron`：表达式与可选 IANA timezone。

Server 校验 cadence、计算 `nextRunAt`，并记录 revision、status、last run 和 timestamps。Schedule 状态为 `active`、`paused` 或 `completed`。一次性 Schedule 在终态 run 后完成。

## Targets

Schedule 可以指向：

- `new-thread`：选择 Agent、content，以及可选 working directory 与 title；
- `thread`：用新内容继续已有 Cypheria Thread；
- `web3`：使用已校验参数调用允许的 Web3 runtime method。

Thread content 使用与交互 turn 相同的类型化 input blocks 和 Agent capability checks。新建的 Thread ID 会记录在 run 中。

## 持久化与租约

Definition 和 run record 保存于 SQLite。Run 记录所属 schedule、计划时间、实际开始和结束、target kind、status、可选新建 Thread、result 与 error。Run 状态为 `running`、`succeeded`、`failed` 或 `interrupted`。

执行使用持久 lease，确保只有一个 worker 获取到期 occurrence。Lease 与 revision checks 阻止第二个进程或恢复流程并发执行同一 occurrence。手动运行也使用相同 run-record 路径。

## 启动恢复

Server 启动时：

1. 把遗留的 running records 标为 interrupted；
2. 加载 active definitions；
3. 重新计算有效的 next occurrences；
4. 对到期且可恢复的工作只 claim 并执行一次；
5. 发布 schedule 和 run updates。

恢复不会把未知外部副作用视为可安全重复。错过 cadence 的处理和 next-run 计算是确定性的，并由 schedule tests 覆盖。

## Web3 非重放规则

中断的 Web3 签名或发送 run 绝不会自动重放。其 run 保持 `interrupted` 或 `failed` 并附带审计上下文。用户必须显式启动新 run，创建新 signing intent 并再次通过 policy。

Server 无法确认 provider 是否接受交易时也遵循同一规则。不会根据交易 method name 推断幂等性。

## 操作

协议支持 create、get、list、update、pause、resume、delete、manual run 和 run-history list。Change notification 保持客户端同步。Mutation 返回权威 schedule 或 run 值。

Schedule target 保持在当前产品边界内。复杂 workflow engine 和多 Agent 编排尚未实现。

## 安全与可观测性

- 执行前校验 cadence、timezone、target、Agent capability、Thread state 和 Web3 method。
- 执行时重新评估 policy；创建 Schedule 不等于签名审批。
- 在 audit event 中记录 schedule 与 run correlation。
- 从 target parameters、results、errors 和 logs 中脱敏 secrets。
- 限制执行时间，并在终态后释放 lease。
- 进度或恢复绝不依赖已连接的 Desktop 客户端。
