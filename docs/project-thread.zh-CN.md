# Project、Thread 与 Section 操作

本文定义 Cypheria 自己拥有的 project、thread、project 成员关系、section 和 section 成员关系操作。关系模式、字段类型、约束和索引另见[数据库指导](database.zh-CN.md)。

## 身份与共用输入

Project、thread 和 section 身份均为 Cypheria 生成的 UUIDv7。Pinned section 使用固定身份：

```text
01984de2-8f74-7c91-a3b2-5c5e937cf318
```

Section 成员关系使用判别式引用：

```ts
type SectionItemRef =
  | { type: "thread"; id: string }
  | { type: "project"; id: string }
```

操作输入输出中的时间戳均为 Unix 秒。Service 属性使用 camel case，包括 `agentSessionId`、`forkedFromId`、`recencyAt`、`createdAt` 和 `updatedAt`。

## 有序列表行为

全局 project 列表、全局 thread 列表、每个 project 内的 threads、全局 section 列表，以及每个 section 内的混合 items，都是彼此独立的有序列表。

调用方不能直接写原始 position。有序变更接受可选的 `beforeProjectId`、`beforeThreadId`、`beforeSectionId` 或混合类型的 `beforeItem`；null 或省略表示追加。被引用 item 必须存在于目标列表。移动到自身之前或现有有效位置视为幂等空操作。

每次有序变更都在一个数据库事务内执行，并把每个受影响列表压缩为从零开始的连续 position。全局重排 project 或 thread 不会改变 project/section 成员顺序；改变成员关系也不会改变实体的全局顺序。

## Project 操作

- `createProject({ name, roots, beforeProjectId?, sectionPlacement? })` 生成 UUIDv7，把 project 插入全局列表，并可在同一事务中创建 section 成员关系。新 project 的 `recencyAt` 为 null。
- `getProject(projectId)` 读取一个 project，不隐式展开成员或 section 状态。
- `listProjects({ cursor?, limit?, sortKey?, sortDirection? })` 支持按 `position` 和 `recencyAt` 排序；recency 排序始终把 null 放在末尾。
- `updateProject(projectId, { name?, roots? })` 只修改用户可写元数据，不能写全局 position、section 成员关系或 recency。
- `moveProject({ projectId, beforeProjectId? })` 只改变全局 project 顺序。
- `deleteProject(projectId)` 删除该 project 的 project/section 成员关系、保留其中 threads、压缩受影响列表，并原子删除 project。

## Thread 操作

- `createThread({ agentId, forkedFromId?, title?, cwd?, recencyAt?, beforeThreadId?, projectPlacement?, sectionPlacement? })` 生成 UUIDv7，并原子创建 thread 及可选的 project/section 成员关系；预留的 `agentSessionId` 字段为 null。
- `getThread(threadId)` 按 Cypheria 身份读取 thread。
- `listThreads({ agentId?, projectId?, sectionId?, forkedFromId?, cursor?, limit?, sortKey?, sortDirection? })` 支持按全局 `position` 和 `recencyAt` 排序。
- `updateThread(threadId, { title?, cwd? })` 只修改用户可写元数据。Agent 身份、fork 来源、recency、位置和成员关系都有专用语义。
- `touchThreadRecency({ threadId, recencyAt })` 单调推进 thread recency，并在同一事务中重算当前 project 的 recency。
- `moveThread({ threadId, beforeThreadId? })` 只改变全局 thread 顺序。
- `deleteThread(threadId)` 删除其 project/section 成员关系，由自引用外键清空子 thread 的 `forkedFromId`，压缩受影响列表、重算原 project recency，并原子删除 thread。

`agentId` 和 `forkedFromId` 在 thread 创建后不可修改。Thread 与 agent session 的关联暂不进入当前操作面：尚不实现创建时绑定、按 agent session 查询以及绑定或更新操作。

## Project 成员关系操作

- `getThreadProject(threadId)` 返回 thread 唯一的 project 成员关系（若存在）。
- `listProjectThreads({ projectId, cursor?, limit? })` 按 project-item 顺序返回 threads。
- `moveThreadToProject({ threadId, projectId, beforeThreadId? })` 新增、重排或移动成员关系；跨 project 移动时原子压缩两个列表并重算双方 recency。
- `removeThreadFromProject(threadId)` 删除成员关系、压缩原 project 并重算其 recency；成员关系不存在时视为幂等成功。

Project 成员关系不影响 section 成员关系。一个 thread 可以属于一个 project，并独立出现在一个 section 中。

成员关系首次创建时，`createdAt` 和 `updatedAt` 使用当前 Unix 秒。在同一 project 内重排时保留 `createdAt`，并推进所有实际存储 position 发生变化行的 `updatedAt`。移入另一个 project 会开始一段新的成员关系，因此两个时间戳都重置。

## Section 操作

- `ensurePinnedSection()` 是仅供初始化使用的幂等操作，用于插入或验证固定 pinned section。
- `createSection({ name, icon?, color?, beforeSectionId? })` 生成 UUIDv7，并把普通 section 插入 pinned section 之后。
- `getSection(sectionId)` 读取一个 section。
- `listSections({ cursor?, limit? })` 按全局 section 顺序返回，pinned section 始终在最前面。
- `updateSection(sectionId, { name?, icon?, color? })` 更新普通 section；pinned section 的身份和名称不可变。
- `moveSection({ sectionId, beforeSectionId? })` 重排普通 section，不改变其中 items。Pinned section 不可移动，普通 section 也不能移动到它之前。
- `deleteSection(sectionId)` 拒绝 pinned ID，只删除该 section 的成员关系、保留所引用的 projects/threads，并压缩全局 section 顺序。

## Section 成员关系操作

- `getItemSection(item)` 返回 thread 或 project 唯一的 section 成员关系（若存在）。
- `listSectionItems({ sectionId, cursor?, limit? })` 返回一个已加载 thread/project 的有序判别联合。
- `moveItemToSection({ item, sectionId, beforeItem? })` 新增、重排或移动 thread/project。两类 item 共享 section position 域，因此 `beforeItem` 可以是任意一种。跨 section 移动时原子压缩两个列表。
- `removeItemFromSection(item)` 删除成员关系并压缩原 section；成员关系不存在时视为幂等成功。
- `pinItem({ item, beforeItem? })` 使用固定 pinned section ID 调用 `moveItemToSection`。
- `unpinItem(item)` 只在当前 section 是 pinned 时移除成员关系。它不会恢复更早的 section，因为不保存成员关系历史。

Section 成员关系首次创建时，`createdAt` 和 `updatedAt` 使用当前 Unix 秒。在同一 section 内重排时保留 `createdAt`，并推进所有实际存储 position 发生变化行的 `updatedAt`。移入另一个 section 会开始一段新的成员关系，因此两个时间戳都重置。

## Recency 不变量

Thread 的 `recencyAt` 在发生有效活动前为 null。`touchThreadRecency` 取当前值与传入 Unix 秒中的较大值，因此延迟事件不能让 recency 倒退。

Project 的 `recencyAt` 是当前成员 threads 中所有非空 `recencyAt` 的最大值；没有成员具备 recency 时为 null。该值不能直接写入。创建、移动或删除 project 成员关系，推进成员 thread recency，或者删除成员 thread 时，都在同一事务中重算所有受影响的 project。
