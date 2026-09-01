# 数据库指导

Cypheria 通过 Drizzle ORM 和 libSQL 本地 SQLite driver 使用 SQLite。`packages/db/src/schema/` 下按领域拆分并由 `schema/index.ts` 汇总导出的文件是唯一可编辑模式源，`packages/db/drizzle` 中生成的 SQL 是唯一迁移源；不要再在 TypeScript 中维护手写 `CREATE TABLE` 语句。

## SQLite 字段约定

SQLite 的存储类别只有 `NULL`、`INTEGER`、`REAL`、`TEXT` 和 `BLOB`。Drizzle mode 负责把它们映射成严格 TypeScript 类型，但编译期推导不能替代数据库约束和运行时校验。

- ID：当持久化层负责创建 UUID 时，使用 `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())`。只有确实需要数据库自增行号时才使用 `integer("id", { mode: "number" }).primaryKey({ autoIncrement: true })`。领域层拥有的 ID 应显式传入。
- 布尔值：使用 `integer("enabled", { mode: "boolean" })`；SQLite 保存 `0/1`，Drizzle 暴露 `boolean`。
- 时间：Cypheria 记录统一使用非空的 ISO-8601 UTC `text`。规范化 ISO 文本可读且能按时间排序。只有某个领域经测量并明确需要数值时间时才采用 `integer(..., { mode: "timestamp_ms" })`。`$defaultFn()` 只是应用侧默认值，不会写进 Drizzle Kit migration；若所有写入方都必须获得默认值，应使用 SQL 默认值。
- JSON：优先使用 `text("metadata", { mode: "json" }).$type<Metadata>()`。SQLite JSON 函数处理文本 JSON，Drizzle 官方明确建议 JSON 使用 text 而非 JSON-mode BLOB。`.$type()` 只提供编译期类型，读取不可信或持久化数据时仍须使用所属领域包的 Zod schema 校验。BLOB 应留给真正的二进制数据。
- 类枚举字段：使用 `text("status", { enum: statuses })` 获得 TypeScript 字面量推导，同时增加具名 `CHECK` 约束来实施数据库校验。Drizzle 的 `enum` 选项本身不会校验运行时值。
- 金额和 Web3 数量：绝不使用 `REAL`。法币只有在币种精度明确且数值不超过 JavaScript 安全整数时，才能以最小货币单位整数保存。原生币/token 数量应采用最小单位的规范十进制 `TEXT`（或明确记录的 bigint 编码），因为 256 位数值会超过 SQLite 和 JavaScript 安全整数。
- 文本：使用 `text`；SQLite 不会实施 `varchar(n)` 长度。确有长度限制时使用应用校验或 `CHECK`。
- 约束：可由数据库实施的不变量应使用 `NOT NULL`、外键、唯一索引和具名 `CHECK`。结构性和跨行不变量继续在 package/IPC 边界使用 Zod 校验。

JSON 适合通常整体读写且大小有界的聚合数据。需要频繁过滤、join、独立更新或唯一性约束的属性，应提升为关系列或子表。

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
- 时间保存为规范 ISO UTC 文本，高精度 Web3 数量保存为十进制文本。
- 私钥、助记词材料、vault encryption key 和解密 signer 不得进入 SQLite、JSON 字段、日志或 audit payload。
- 对可能并发修改的记录使用单调递增 `revision` 做 compare-and-swap 更新。

参考：[SQLite column types](https://orm.drizzle.team/docs/sqlite/column-types)、[`drizzle-kit generate`](https://orm.drizzle.team/docs/drizzle-kit-generate) 和 [`drizzle-kit migrate`](https://orm.drizzle.team/docs/sqlite/drizzle-kit-migrate)。
