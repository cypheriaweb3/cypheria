# Cypheria Marketplace 设计

## 决策

`apps/marketplace` 是 Cypheria 自有的插件发布平台，而不是 Git 仓库的只读投影。它使用 TanStack Start 并部署到 Cloudflare Workers，包含三个界面：

- 面向用户的公开插件市场，负责发现与安装入口。
- 面向发布者的控制台，负责草稿、扫描、提交、版本与状态。
- 面向审核者的控制台，负责 finding、decision、suspension 和 audit history。

Cypheria Desktop 在同一套 Codex-compatible 安装模型上支持两条发现渠道：

1. **Cypheria Marketplace**：从 `apps/marketplace` 自有公共 API 发现；审核通过的 release 被汇总到 Cypheria 官方公开 GitHub marketplace repository，Desktop 通过 Codex App Server 注册并安装。
2. **Codex 兼容来源**：通过随 Desktop 捆绑的 Codex App Server 发现和管理，包括该版本 App Server 暴露的公开远程目录、个人、分享、工作区、仓库、Git、npm 和本地 marketplace 来源。

两条渠道可以共用 UI 和 App Server 安装执行器，但必须明确保留各自的身份、来源、信任状态和更新策略。Cypheria 不代理、重新发布或宣称拥有 OpenAI universal plugin directory。

主要资料：

- [OpenAI：提交插件](https://developers.openai.com/plugins/deploy/submission)
- [OpenAI：打包插件](https://developers.openai.com/plugins/build/plugins)
- [ChatGPT 与 Codex 插件](https://learn.chatgpt.com/docs/plugins)
- [Cloudflare：在 Workers 上运行 TanStack Start](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)

## 产品契约

每个 Cypheria Marketplace 插件都必须遵循公开的 ChatGPT/Codex plugin 规范。Source 必须包含 `.codex-plugin/plugin.json`，并可在 plugin root 包含 `skills/`、`hooks/`、`.app.json`、`.mcp.json` 和 `assets/`。一次提交可以仅包含 Skills、包含带可选 UI 的 MCP server，或同时包含两者。

发布者需提供 listing 信息、已验证的发布者身份、GitHub source、能力元数据、政策链接、starter prompts、测试、可用地区、release notes 和声明。MCP 提交还需提供 endpoint、认证方式、必要的审核凭据、CSP domain、domain proof、扫描得到的 tool schema 和真实的风险 annotation。审核始终扫描提交的 GitHub commit 解析出的 plugin tree。

审核通过与正式发布必须分离。审核通过只让版本获得发布资格；发布者仍需显式发布。每个已发布 release 都是不可变的审核快照。若 executable content、MCP metadata、skill、permission、policy URL 或其他影响审核的字段变化，必须创建新版本并重新审核。

## Source 与开源政策

Cypheria 只接受 marketplace entry source type `url` 和 `git-subdir`：

- Plugin root 位于 GitHub repository root 时使用 `url`。
- Plugin root 位于 GitHub monorepo 的子目录时使用 `git-subdir`。

两种形式都必须使用规范化的 HTTPS `github.com` repository URL 和不可变的完整 commit SHA。`git-subdir.path` 必须以 `./` 开头、不能越出 repository，并在该 commit 上解析到 plugin root。Cypheria 拒绝 `local`、`npm`、可变 archive/download URL、private repository、非 GitHub Git host、只提供移动 ref、submodule indirection，以及加载插件所必需的 Git LFS pointer。

Source repository 必须公开且真正符合开源定义。自动检查 public visibility、精确 commit、repository/path identity、`.codex-plugin/plugin.json`，以及覆盖提交 plugin path 的已识别 OSI-approved SPDX license。Monorepo license 范围不清、只有 generated source、缺少 license text，或使用 source-available/非开源 license 时阻止提交，直到 reviewer 能确认覆盖范围。Publisher 的 GitHub ownership/maintainership 与 license 分开验证。

Canonical catalog entry 记录 `source`、`url`、可选 `path` 和 `sha`。Branch 或 tag 只能保留为信息性 provenance，安装不能依赖它。更新时提交新的 commit SHA，并产生新的 review revision。

Canonical source 示例：

```json
{
  "name": "wallet-risk-review",
  "source": {
    "source": "url",
    "url": "https://github.com/example/wallet-risk-review.git",
    "sha": "0123456789abcdef0123456789abcdef01234567"
  },
  "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
  "category": "Web3 Security"
}
```

```json
{
  "name": "transaction-simulator",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/example/web3-plugins.git",
    "path": "./plugins/transaction-simulator",
    "sha": "89abcdef0123456789abcdef0123456789abcdef"
  },
  "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
  "category": "Web3 Security"
}
```

## 范围

V1 包括：

- Account、organization、membership、role 和 verified publisher identity。
- Skills-only、MCP-only 与组合插件草稿。
- 分区表单：Info、MCP、Skills、Prompts、Testing、Availability 和 Submit。
- 可恢复的校验与扫描，以及结构化 finding。
- Reviewer 分配、note、修改请求、批准、拒绝和审计历史。
- 审核通过后由 publisher 主动发布。
- Public catalog、category、search、detail、version、trust signal、advisory、suspension 和 withdrawal。
- 供 Cypheria Desktop 使用的版本化公共 API。
- 带 digest 的不可变 source snapshot、public asset 与 review evidence。

V1 不包括支付、分成、token、链上 registry、评分、不可验证的热度、在 Web Worker 内执行任意插件、代理 MCP 流量、终端用户 connector credential、自动向 OpenAI 发布，以及网页或 renderer 对 `$CYPHERIA_HOME` 的写权限。

## 生命周期

```txt
DRAFT -> SCANNING -> READY_TO_SUBMIT -> SUBMITTED -> IN_REVIEW
  -> CHANGES_REQUESTED -> DRAFT
  -> REJECTED
  -> APPROVED -> READY_TO_PUBLISH -> PUBLISHED -> SUSPENDED | WITHDRAWN
```

- 提交需要 publisher write 权限和已验证身份。
- 必需检查缺失、过期或失败时不能提交。
- `SUBMITTED` 冻结不可变 review revision；后续编辑创建新 revision。
- 审核决定绑定 content digest，而不只绑定可变 plugin ID。
- 审核通过绝不自动发布。
- 已发布版本不可原地编辑；更新创建新版本。
- Suspension 阻止新安装但保留历史；Desktop 会收到已安装版本的 advisory 与 revocation 状态。

## 系统架构

```txt
Browser
  -> apps/marketplace (TanStack Start SSR + server functions)
     -> D1: identity、draft、scan、review、release、catalog、audit
     -> R2: asset、skill bundle、不可变 review snapshot
     -> Queues: scan、notification、indexing、publication job
     -> Workflows: scan/submission/review/publication 编排
     -> GitHub App: 发布确定性的 catalog projection

Cypheria 官方 marketplace repository
  -> .agents/plugins/marketplace.json
  -> approved entry 使用 GitHub url 或 git-subdir + immutable sha

Cypheria Desktop
  -> Cypheria Marketplace API
  -> Codex App Server marketplace/add(Cypheria GitHub repo)
  -> marketplace/upgrade + plugin/install
  -> $CYPHERIA_HOME/codex

Desktop 其他来源
  -> Codex App Server public/personal/shared/workspace/repo/local 来源
```

`apps/marketplace` 是独立远程信任边界，不得导入 Electron、desktop IPC、`@cypheria/runtime`、`@cypheria/codex-bridge` 或 `@cypheria/db` 的本地 SQLite adapter。边界稳定后，可通过专用 package 共享与运行环境无关的 schema、API contract 和 UI primitive。

## Cloudflare 设计

使用官方 TanStack Start Workers 集成：把 `@cloudflare/vite-plugin` 放在 TanStack Start plugin 之前；自定义 Worker entrypoint 将 HTTP 委托给 `@tanstack/react-start/server-entry`；使用 Wrangler 生成 binding type；提交 D1 migration。

- **Workers**：SSR、API、认证回调、鉴权、校验、GitHub callback 与 webhook。
- **D1**：发布状态的 source of truth，也是 public catalog 的 query store。
- **R2**：默认私有、不可变、content-addressed 的 asset 与 artifact。
- **Queues**：有界异步 scan、indexing、notification 和 catalog-publication job。
- **Workflows**：等待扫描或人工审核、可幂等恢复的持久多步骤流程，包括 GitHub catalog reconciliation。
- **Cron triggers**：reconciliation、stale draft cleanup、endpoint revalidation 和 advisory refresh，不是主要发布路径。

不得在 request Worker 中运行第三方 hook、shell command、package installer 或任意 JavaScript。静态检查可以在严格限制下运行。未来若引入动态执行，必须使用不持有生产凭据的隔离服务，并明确限制 CPU、memory、network 和 time。

## GitHub Marketplace 投影

Cypheria 运营一个公开 GitHub repository，其 `$REPO_ROOT/.agents/plugins/marketplace.json` 是所有当前已发布且未暂停 release 的 Codex-installable projection。D1 仍是 submission/review 的 source of truth；该 repository 是供 App Server 使用的确定性分发投影。

发布使用 outbox 加单写者 Queue/Workflow：

```txt
publisher 请求发布
  -> D1 记录 PUBLISH_REQUESTED + outbox event
  -> worker 选择全部 active approved release
  -> 生成 canonical、稳定排序的 marketplace.json
  -> 校验每个 entry 与 content digest
  -> 通过最小权限 GitHub App 提交
  -> 回读并验证 repository blob + commit SHA
  -> 记录 catalog_commit_sha
  -> 将 release 标记为 PUBLISHED 并开放 public API
```

并发 job 使用 expected-head comparison，并从最新 D1 state 重试。Reconciliation 每次重新生成完整文件，因此 retry、漏事件、withdrawal 与 suspension 都会收敛，不接受人工编辑。生成分支受保护；GitHub credential 仅存为 Worker secret，不进入 D1/R2；GitHub App 只拥有该 repository 的 contents 权限。

每个 entry 只包含经过审核、由 `sha` 固定的 GitHub `url` 或 `git-subdir` source、必需的 install/auth policy、category 和审核后的 interface metadata。Repository 不是 review database，也不复制第三方 plugin code。

Catalog commit 是 publication barrier：对应 verified commit 存在后，release 才能成为 `PUBLISHED`。Suspension/withdrawal 会发布移除该 entry 的新 catalog commit。已经安装的 cache 不会被静默删除；Desktop 展示 Marketplace advisory，并要求用户明确更新或卸载。

V1 按 App Server repo-marketplace contract 使用一个汇总 repository。这里存在已知规模边界，因为当前面向 client 的 `plugin/list` response 不分页。因此 Desktop 使用 cursor-paginated Cypheria API 浏览，只在注册/升级 catalog，以及读取或安装选中插件时调用 App Server。必须监控生成 JSON 的大小、entry 数量、App Server refresh latency、memory 和 JSON-RPC payload size。在预算变得不安全前，应在可用时采用 App Server paginated search method，或版本化兼容的 sharding strategy；不得静默截断 catalog。

## 信息架构与 API

```txt
Public
  /:locale/plugins
  /:locale/plugins/$publisher/$slug
  /:locale/categories/$category
  /:locale/advisories/$id
  /:locale/publish

Publisher
  /:locale/console
  /:locale/console/plugins/new
  /:locale/console/plugins/$pluginId/submissions/$submissionId/$section
  /:locale/console/plugins/$pluginId/releases
  /:locale/console/organization

Reviewer
  /:locale/review
  /:locale/review/submissions/$submissionId
  /:locale/review/plugins/$pluginId
  /:locale/review/audit

Desktop/public API
  GET /api/v1/plugins?cursor=&limit=
  GET /api/v1/plugins/$publisher/$slug
  GET /api/v1/plugins/$publisher/$slug/releases/$version
  GET /api/v1/advisories
  GET /api/v1/desktop/catalog
  GET /api/v1/desktop/catalog-status
```

Publisher/reviewer mutation 使用认证后的 server function 或 `/api/v1/console/*` route，并包含 CSRF protection、authorization、idempotency key 和 audit write。Public API 与 UI loader 独立版本化，Desktop 不依赖 route 内部实现。

## 核心数据模型

```txt
users, organizations, organization_memberships
publisher_identities, publisher_verifications
plugins, plugin_drafts
submissions, submission_revisions, submission_artifacts
github_sources, github_verifications
submission_prompts, submission_tests, submission_availability
scan_runs, scan_findings
review_assignments, review_events, review_decisions
releases, release_artifacts, publications, catalog_publication_jobs
security_advisories
audit_events, idempotency_keys
```

与政策相关和可搜索的字段保留为 typed column。有大小限制的 JSON 可存储版本化扩展 metadata、tool schema、CSP declaration 和 scan output。每个 revision 与 release 都记录 canonical content、artifact 和 manifest digest。Audit row 只追加。

## 校验与审核

自动检查包括 ChatGPT/Codex plugin 与 marketplace schema；精确的 GitHub public-repository/commit resolution；允许的 `url`/`git-subdir` 形态；path containment；license coverage；source size/file-count 边界；malware、secret、executable content、dependency 与 prohibited file；MCP reachability 与 protocol enumeration；schema quality、authentication/CSP 一致性；domain proof；redirect/response 边界；tool annotation 一致性；positive/negative test；publisher 与 policy ownership 一致性。

远程抓取必须阻止 loopback、link-local、private、metadata-service 和 DNS rebinding 目标；每次重定向重新校验；限制 TLS、大小与超时；绝不附带 Marketplace credential。Reviewer demo secret 加密、严格限权、写入后不返回，并按 retention policy 删除。

自动检查不等于审核通过。Reviewer 检查不可变 revision、finding、test evidence、permission、data-handling declaration、与上一 release 的 diff 和历史决定。每次决定和状态变化都记录 actor、timestamp、reason 和 revision digest。

## Desktop 集成

Desktop 在同一个 Plugins 区域中提供按来源区分的 section，不把不同信任域压平成一个列表。

### Cypheria Marketplace provider（待实现）

Electron main 调用版本化 Marketplace API，获得分页发现结果、Cypheria review state、advisory 和预期 GitHub catalog commit；renderer 只接收严格 Zod projection。安装仍由 App Server 执行：

```txt
选择 published release
  -> 校验 publication、GitHub source、commit SHA 与 catalog commit
  -> 展示 source/capability/permission/auth/review 摘要
  -> 获得明确批准
  -> 缺少时 marketplace/add Cypheria 官方 GitHub repository
  -> marketplace/upgrade 并要求达到预期 catalog commit
  -> 从解析后的 local marketplace 执行 plugin/read
  -> 通过 Codex App Server plugin/install
  -> 写入 receipt 与 audit event
  -> 刷新 plugin/skill/app/MCP inventory
```

Desktop 在应用配置中固定官方 repository URL，不接受 renderer 提供替代值。在调用 App Server 前，main 交叉检查 plugin name、source URL/path/SHA、release state 与 catalog commit。未发布、已暂停、不匹配、过期 catalog 或不兼容的 entry 会被拒绝。更新和卸载也使用 App Server；Cypheria 在调用前后增加 review/advisory 检查与本地 audit receipt。

因此 Cypheria Marketplace 是一等 discovery/trust provider，但不是第二套 plugin runtime 或 installer。其插件都是标准 ChatGPT/Codex plugin，官方 GitHub repository 将 Cypheria publication state 适配到现有 App Server marketplace contract。

### Codex App Server provider（已实现）

Desktop 已经通过生成的 App Server method 调用 `plugin/list`、`plugin/read`、`plugin/install`、`plugin/uninstall`、通过 `config/value/write` 控制插件启停、`skills/list`、`skills/config/write`，以及 `marketplace/add`、`marketplace/upgrade` 和带保护的 `marketplace/remove`。

它分别查询这些生成的 marketplace kind：

- `vertical`：App Server 暴露的公开远程目录。
- `workspace-directory`：工作区提供的 marketplace。
- `shared-with-me`：分享给当前用户的远程 marketplace。
- `created-by-me-remote`：当前用户创建的远程 marketplace。
- `local`：由 App Server 解析的个人、仓库、Git/npm-backed 或本地来源。

`marketplace/add` 接收 App Server source string、可选 ref 和 sparse path，所以 parsing、clone、upgrade 和 installation 都由 App Server 负责。Desktop 保留 provenance 与 partial failure，在 Electron main 中重新校验破坏性操作，并把状态限定在 `CODEX_HOME="$CYPHERIA_HOME/codex"`。

这属于兼容支持，不是 Cypheria Marketplace provider。Public 和 account-scoped remote source 依赖捆绑的 App Server、feature flag、account、workspace policy 与网络。Desktop 必须真实展示失败，不能用 Cypheria 数据替代。

## 认证、运维与恢复

- 使用 OIDC 与 HTTP-only、`Secure`、`SameSite=Lax` session；mutation 有 CSRF protection；identity、submission、publication、suspension 和 key rotation 使用 step-up authentication。
- Organization 包含 `owner`、`publisher`、`reviewer` 和 `viewer` role；reviewer 权限仅限 Cypheria 运营的审核组织。
- Publisher verification 是可审计的一等记录，基于 domain/organization evidence 和人工审核，不能从邮箱推断 badge。
- Marketplace 不保存 wallet key、Desktop bearer token 或终端用户 MCP credential。GitHub App private key/token 是定期轮换、repository-scoped 的 Worker secret。
- Structured log 排除 secret 和 bundle 内容；metrics 覆盖 API、queue lag、workflow failure、scan duration、review age、publication、download 和 catalog freshness。
- 测试 D1 backup/restore 与 migration rollback；R2 lifecycle 保留 published artifact 和 review evidence，清理 abandoned upload 与 review secret。
- Queue consumer 和 workflow step 必须幂等。发布使用 outbox/event record、expected Git head、read-after-write verification 和 scheduled reconciliation，防止 D1 与 GitHub catalog 静默分叉。

## 交付顺序

1. 搭建 Workers/TanStack Start、binding、本地开发、CI 和公开页面骨架。
2. 添加 auth、organization、role、publisher verification、D1 migration、R2 artifact 和 audit event。
3. 实现 GitHub-only source verification，以及 Info/Skills/MCP/Prompts/Testing/Availability/Submit draft 流程。
4. 实现有界 source/MCP scanner、Queues、Workflows、reviewer UI、decision 和 change request。
5. 实现 immutable release、确定性 GitHub marketplace publisher、public API、advisory、suspension 和 withdrawal。
6. 在 Desktop 中添加 Cypheria discovery/trust provider，并通过现有 App Server marketplace operation 安装。
7. 端到端验证 submission、review、publication、installation、update、revocation 和 recovery。
