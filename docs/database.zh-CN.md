# 数据库指导

Cypheria 通过 Drizzle ORM 和 libSQL 本地 SQLite driver 使用 SQLite。`packages/db/src/schema/` 下按领域拆分并由 `schema/index.ts` 汇总导出的文件是唯一可编辑模式源，`packages/db/drizzle` 中生成的 SQL 是唯一迁移源；不要再在 TypeScript 中维护手写 `CREATE TABLE` 语句。

## SQLite 字段约定

SQLite 的存储类别只有 `NULL`、`INTEGER`、`REAL`、`TEXT` 和 `BLOB`。Drizzle mode 负责把它们映射成严格 TypeScript 类型，但编译期推导不能替代数据库约束和运行时校验。

- ID：当持久化层负责创建 UUID 时，使用 `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())`。只有确实需要数据库自增行号时才使用 `integer("id", { mode: "number" }).primaryKey({ autoIncrement: true })`。领域层拥有的 ID 应显式传入。
- 布尔值：使用 `integer("enabled", { mode: "boolean" })`；SQLite 保存 `0/1`，Drizzle 暴露 `boolean`。
- 时间：除非领域明确记录数值时间例外，否则 Cypheria 记录统一使用非空的 ISO-8601 UTC `text`。规范化 ISO 文本可读且能按时间排序。下文的 project/thread/section 表就是一个例外：其中所有时间戳都使用 SQLite `INTEGER` 保存 Unix 秒，以便直接比较 recency 和有序列表记录。`$defaultFn()` 只是应用侧默认值，不会写进 Drizzle Kit migration；若所有写入方都必须获得默认值，应使用 SQL 默认值。
- JSON：优先使用 `text("metadata", { mode: "json" }).$type<Metadata>()`。SQLite JSON 函数处理文本 JSON，Drizzle 官方明确建议 JSON 使用 text 而非 JSON-mode BLOB。`.$type()` 只提供编译期类型，读取不可信或持久化数据时仍须使用所属领域包的 Zod schema 校验。BLOB 应留给真正的二进制数据。
- 类枚举字段：使用 `text("status", { enum: statuses })` 获得 TypeScript 字面量推导，同时增加具名 `CHECK` 约束来实施数据库校验。Drizzle 的 `enum` 选项本身不会校验运行时值。
- 金额和 Web3 数量：绝不使用 `REAL`。法币只有在币种精度明确且数值不超过 JavaScript 安全整数时，才能以最小货币单位整数保存。原生币/token 数量应采用最小单位的规范十进制 `TEXT`（或明确记录的 bigint 编码），因为 256 位数值会超过 SQLite 和 JavaScript 安全整数。
- 文本：使用 `text`；SQLite 不会实施 `varchar(n)` 长度。确有长度限制时使用应用校验或 `CHECK`。
- 约束：可由数据库实施的不变量应使用 `NOT NULL`、外键、唯一索引和具名 `CHECK`。结构性和跨行不变量继续在 package/IPC 边界使用 Zod 校验。

JSON 适合通常整体读写且大小有界的聚合数据。需要频繁过滤、join、独立更新或唯一性约束的属性，应提升为关系列或子表。

## Project、thread 与 section 存储

Cypheria 自己拥有跨 agent 的 project、thread、project 成员关系、section 与 section 成员关系。该模型使用五张表：`projects`、`threads`、`project_items`、`sections` 和 `section_items`。Project 成员关系与 section 成员关系彼此独立：一个 thread 可以属于一个 project，同时也能直接出现在一个 section 中，包括 pinned section。

这五张表中的所有时间戳都使用 SQLite `INTEGER` 保存 Unix 秒。Project、thread 和 section ID 是由 Cypheria 生成并在 package 边界校验的 UUIDv7。Pinned section 使用固定 UUIDv7 `01984de2-8f74-7c91-a3b2-5c5e937cf318`。Drizzle 和 service 属性使用 camel case（`recencyAt`、`forkedFromId`、`agentSessionId`、`createdAt`、`updatedAt`），SQLite 物理字段则遵循下表所示的现有 snake-case 约定。

### `projects`

| 字段 | 存储类型 | 可空性 | 含义 |
| --- | --- | --- | --- |
| `id` | `TEXT` | 非空，主键 | Cypheria UUIDv7 project 身份。 |
| `name` | `TEXT` | 非空 | 用户可见的 project 名称。 |
| `roots` | `TEXT` JSON | 非空 | 规范化绝对路径的有序非空数组；第一项是默认 root。 |
| `position` | `INTEGER` | 非空 | 在全局 projects 列表中的位置。 |
| `recency_at` | `INTEGER` | 可空 | 成员 thread 中最新的 recency；不存在时为 null。 |
| `created_at` | `INTEGER` | 非空 | Unix 秒创建时间。 |
| `updated_at` | `INTEGER` | 非空 | project 行最后一次持久化变更的 Unix 秒时间。 |

`position` 非负且唯一。`recency_at` 是一个物化值，等价于该 project 的 `project_items` 中所有非空 `threads.recency_at` 的最大值；若不存在这样的非空 recency，则为 null。

### `threads`

| 字段 | 存储类型 | 可空性 | 含义 |
| --- | --- | --- | --- |
| `id` | `TEXT` | 非空，主键 | Cypheria UUIDv7 thread 身份。 |
| `agent_id` | `TEXT` | 非空 | 指向 `agent_registry.id` 的不可变外键。 |
| `agent_session_id` | `TEXT` | 可空 | 所绑定 agent 自己的 session/thread 身份。 |
| `forked_from_id` | `TEXT` | 可空 | 本 thread 由哪个 Cypheria thread fork 而来。 |
| `title` | `TEXT` | 可空 | 用户设置或自动生成的标题。 |
| `cwd` | `TEXT` | 可空 | thread 捕获的工作目录。 |
| `position` | `INTEGER` | 非空 | 在全局 threads 列表中的位置。 |
| `recency_at` | `INTEGER` | 可空 | 最近一次有效 thread 活动的 Unix 秒时间。 |
| `created_at` | `INTEGER` | 非空 | Unix 秒创建时间。 |
| `updated_at` | `INTEGER` | 非空 | thread 行最后一次持久化变更的 Unix 秒时间。 |

`agent_id` 指向 `agent_registry.id`，使用 `ON DELETE RESTRICT`。`forked_from_id` 指向 `threads.id`，使用 `ON DELETE SET NULL`。`position` 非负且唯一。在 `agent_session_id IS NOT NULL` 条件下，`(agent_id, agent_session_id)` 使用部分唯一索引，防止两个 Cypheria thread 声明同一个 agent session。为 `forked_from_id` 建立查询索引。

`agent_session_id` 为后续的 agent session 关联工作预留，可以为空；`recency_at` 也可以为空。

### `project_items`

| 字段 | 存储类型 | 可空性 | 含义 |
| --- | --- | --- | --- |
| `project_id` | `TEXT` | 非空 | 指向 `projects.id` 的外键。 |
| `thread_id` | `TEXT` | 非空 | 指向 `threads.id` 的外键。 |
| `position` | `INTEGER` | 非空 | thread 在该 project 内的位置。 |
| `created_at` | `INTEGER` | 非空 | thread 进入当前 project 的 Unix 秒时间。 |
| `updated_at` | `INTEGER` | 非空 | 成员关系或位置最后变更的 Unix 秒时间。 |

主键是 `(project_id, thread_id)`。两个外键都使用 `ON DELETE CASCADE`。`thread_id` 唯一，因此一个 thread 最多属于一个 project。`(project_id, position)` 唯一，且 `position` 非负。

### `sections`

| 字段 | 存储类型 | 可空性 | 含义 |
| --- | --- | --- | --- |
| `id` | `TEXT` | 非空，主键 | Cypheria UUIDv7 section 身份。 |
| `name` | `TEXT` | 非空 | 用户可见的 section 名称。 |
| `icon` | `TEXT` | 可空 | 可选的同步图标。 |
| `color` | `TEXT` | 可空 | 可选的同步颜色。 |
| `position` | `INTEGER` | 非空 | 在全局 sections 列表中的位置。 |
| `created_at` | `INTEGER` | 非空 | Unix 秒创建时间。 |
| `updated_at` | `INTEGER` | 非空 | section 行最后一次持久化变更的 Unix 秒时间。 |

`position` 非负且唯一。Pinned section 行的 ID 为 `01984de2-8f74-7c91-a3b2-5c5e937cf318`，位置为零。

### `section_items`

| 字段 | 存储类型 | 可空性 | 含义 |
| --- | --- | --- | --- |
| `id` | `INTEGER` | 非空，自增主键 | 关联行的内部身份。 |
| `section_id` | `TEXT` | 非空 | 指向 `sections.id` 的外键。 |
| `item_type` | `TEXT` | 非空 | `thread` 或 `project`。 |
| `thread_id` | `TEXT` | 可空 | thread item 指向 `threads.id` 的外键。 |
| `project_id` | `TEXT` | 可空 | project item 指向 `projects.id` 的外键。 |
| `position` | `INTEGER` | 非空 | thread/project 在该 section 内的统一位置。 |
| `created_at` | `INTEGER` | 非空 | item 进入当前 section 的 Unix 秒时间。 |
| `updated_at` | `INTEGER` | 非空 | 成员关系或位置最后变更的 Unix 秒时间。 |

具名 `CHECK` 约束要求恰好存在一个目标，并与 `item_type` 一致：`thread` 要求 `thread_id` 非空且 `project_id` 为空；`project` 要求 `project_id` 非空且 `thread_id` 为空。三个外键均使用 `ON DELETE CASCADE`。对非空 `thread_id` 和非空 `project_id` 分别建立部分唯一索引，使每个实体最多位于一个 section。`(section_id, position)` 唯一，且 `position` 非负。

Thread 和 project 共享一个 position 域，因此可以精确混排。

### Position 范围

五个 position 域彼此独立：

| Position | 范围 |
| --- | --- |
| `projects.position` | 所有 projects。 |
| `threads.position` | 所有 threads。 |
| `project_items.position` | 单个 project 内的 threads。 |
| `sections.position` | 所有 sections。 |
| `section_items.position` | 单个 section 内的 threads 和 projects。 |

更高层的变更与排序行为在 [Project、Thread 与 Section 操作](project-thread.zh-CN.md) 中单独定义。

## 迁移工作流

Cypheria 统一采用 Drizzle 的 code-first `generate` → `migrate` 流程：

```sh
pnpm --filter @cypheria/db db:generate --name=<migration-name>
pnpm --filter @cypheria/db db:check
pnpm --filter @cypheria/db db:migrate
```

pnpm 需要使用全局 store，因此这些命令应在受限沙盒外运行。应用或提交前必须审查生成 SQL，并将 schema 目录、生成 SQL、snapshot 和 journal 一起提交。

`drizzle-kit migrate` 会读取生成的迁移目录，与数据库迁移日志比较，仅执行尚未应用的文件，并记录成功结果。Runtime 和测试可调用 `applyDatabaseMigrations`，它使用 Drizzle ORM migrator 执行同一个生成目录，并不是第二套模式定义。

不得修改已经应用的 migration。应修改相应领域 schema 文件、生成新 migration、审查并分别测试空数据库迁移和从最新已提交模式升级。只有在所有环境都尚未应用历史时，或经过明确协调的 baseline reset 中，才允许压缩或删除迁移。

## 当前存储规则

- 默认数据库为 `$CYPHERIA_HOME/db/cypheria.sqlite`，未配置时回退到 `~/.cypheria/db/cypheria.sqlite`。
- 每个连接在正常操作前都要启用 SQLite foreign keys。
- 除非所属领域明确记录其他格式，否则时间保存为规范 ISO UTC 文本。上文五张 project/thread/section 表使用 Unix 秒。高精度 Web3 数量保存为十进制文本。
- 私钥、助记词材料、vault encryption key 和解密 signer 不得进入 SQLite、JSON 字段、日志或 audit payload。
- 对可能并发修改的记录使用单调递增 `revision` 做 compare-and-swap 更新。

参考：[SQLite column types](https://orm.drizzle.team/docs/sqlite/column-types)、[`drizzle-kit generate`](https://orm.drizzle.team/docs/drizzle-kit-generate) 和 [`drizzle-kit migrate`](https://orm.drizzle.team/docs/sqlite/drizzle-kit-migrate)。
