# Thread 协议

Cypheria 的公开 agent 协议只使用两个产品实体：`Agent` 是可安装、可启动的执行后端，
`Thread` 是持久、用户可见的对话和工作上下文。Provider session 只是服务端内部实现细节，
因此 `threadId` 是所有 Thread 操作的唯一公开句柄。`Thread.agentSessionId` 是可空、只读的
provider 元数据，协议永远不接受它作为路由键。

Agent 生命周期使用 `agent.list`、`agent.get`、`agent.start` 和 `agent.stop`。Thread 生命周期及
工作统一位于 `thread.*` 命名空间，包括创建、查询、恢复、关闭、turn、timeline、interaction
和删除。Provider 特有方法必须归类为服务端内部方法、provider-neutral Thread 操作、typed
Agent 扩展、typed Thread 扩展或不支持方法。原始 provider 生命周期和订阅调用不属于目标 wire
API。

## Timeline 连续性

只有已提交的 canonical timeline row 才携带 epoch 和 sequence。Agent 状态、Thread 状态、
active turn、权限、attention 和安装进度采用快照或瞬时通知，不参与 timeline 排序。

同一 epoch 内的 canonical row 使用连续 sequence。Projected page 在读取时折叠 message、
reasoning 和 tool lifecycle row，同时保留精确的源 sequence ranges。Protocol 包提供确定性的共享
projector，使 server 和 client 对 cursor 覆盖范围保持一致。

Provider 历史被重建、替换或出现无法增量恢复的缺口时创建新 epoch。普通 turn、取消、元数据
更新和只修改文件的操作保持当前 epoch。Timeline replacement 只发送一次失效通知，不重放完整
历史；客户端随后读取有界 tail page，并使用 before/after cursor 加载历史和补齐缺口。

V1 中 provider 历史仍是持久 transcript 权威来源。Server 只为已加载 Thread 在内存中维护
canonical rows，并在重启或 cache 淘汰后从 provider 重新 hydration。
