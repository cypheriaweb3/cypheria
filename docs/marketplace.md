# Cypheria Marketplace Design

## Decision

`apps/marketplace` is Cypheria's plugin publication platform, not a read-only projection of a Git repository. It is a TanStack Start application deployed on Cloudflare Workers with three surfaces:

- A public marketplace for discovery and installation.
- A publisher console for drafts, scans, submissions, releases, and status.
- A reviewer console for findings, decisions, suspension, and audit history.

Cypheria Desktop supports two discovery channels over one Codex-compatible installation model:

1. **Cypheria Marketplace**, discovered from the public API owned by `apps/marketplace`. Approved releases are aggregated into an official public Cypheria GitHub marketplace repository, which Desktop registers and installs through Codex App Server.
2. **Codex-compatible marketplaces**, discovered and managed through the bundled Codex App Server. These include OpenAI's official marketplaces and marketplaces added by the user.

The channels may share one UI and the App Server installation executor, but their identity, provenance, trust state, and update policy remain explicit. Cypheria does not proxy, republish, or claim ownership of OpenAI's universal plugin directory.

Primary references:

- [OpenAI: Submit plugins](https://developers.openai.com/plugins/deploy/submission)
- [OpenAI: Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [ChatGPT and Codex plugins](https://learn.chatgpt.com/docs/plugins)
- [Cloudflare: TanStack Start on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)

## Product Contract

Every Cypheria Marketplace plugin must follow the public ChatGPT/Codex plugin specification. Each source contains `.codex-plugin/plugin.json` and may contain `skills/`, `hooks/`, `.app.json`, `.mcp.json`, and `assets/` at the plugin root. A submission may contain skills only, an MCP server with optional UI, or both.

The publisher supplies listing information, a verified publisher identity, a GitHub source, capability metadata, policy links, starter prompts, tests, availability, release notes, and attestations. MCP submissions additionally supply the endpoint, authentication mode, reviewer credentials when required, CSP domains, domain proof, discovered tool schemas, and truthful risk annotations. Review always scans the plugin tree resolved from the submitted GitHub commit.

Approval and publication are separate. Approval makes a version eligible to publish; the publisher must explicitly publish it. Every published release is an immutable reviewed snapshot. Changing executable content, MCP metadata, skills, permissions, policy URLs, or other review-relevant fields creates a new version and review cycle.

## Source And Open-Source Policy

Cypheria accepts only marketplace entry source types `url` and `git-subdir`:

- `url` when the plugin root is the GitHub repository root.
- `git-subdir` when the plugin root is a contained directory in a GitHub monorepo.

Both forms must use a canonical HTTPS `github.com` repository URL and an immutable full commit SHA. `git-subdir.path` must start with `./`, remain within the repository, and resolve to the plugin root at that commit. Cypheria rejects `local`, `npm`, mutable archive/download URLs, private repositories, non-GitHub Git hosts, moving-only refs, submodule indirection, and Git LFS pointers required to load the plugin.

The source repository must be public and genuinely open source. Automated checks verify public visibility, the exact commit, repository and path identity, `.codex-plugin/plugin.json`, and a recognized OSI-approved SPDX license that covers the submitted plugin path. Ambiguous monorepo licensing, generated-only source, missing license text, or a source-available/non-open-source license blocks submission until a reviewer can establish coverage. Publisher GitHub ownership or maintainership is verified separately from the license.

The canonical catalog entry records `source`, `url`, optional `path`, and `sha`. A branch or tag may be retained as informational provenance, but installation never depends on it. Updates submit a new commit SHA and create a new review revision.

Canonical source examples:

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

## Scope

V1 includes:

- Accounts, organizations, memberships, roles, and verified publisher identities.
- Drafts for skills-only, MCP-only, and combined plugins.
- A sectioned form: Info, MCP, Skills, Prompts, Testing, Availability, and Submit.
- Resumable validation and scanning with structured findings.
- Reviewer assignment, notes, change requests, approval, rejection, and audit history.
- Publisher-controlled publication after approval.
- Public catalog, categories, search, details, versions, trust signals, advisories, suspension, and withdrawal.
- A versioned public API consumed by Cypheria Desktop.
- Immutable source snapshots, public assets, and review evidence with digests.

V1 excludes payments, revenue sharing, tokens, an on-chain registry, ratings, unverified popularity, arbitrary plugin execution inside the web Worker, MCP traffic proxying, end-user connector credentials, automatic OpenAI publication, and any browser or renderer write access to `$CYPHERIA_HOME`.

## Lifecycle

```txt
DRAFT -> SCANNING -> READY_TO_SUBMIT -> SUBMITTED -> IN_REVIEW
  -> CHANGES_REQUESTED -> DRAFT
  -> REJECTED
  -> APPROVED -> READY_TO_PUBLISH -> PUBLISHED -> SUSPENDED | WITHDRAWN
```

- Publisher write permission and a verified identity are required to submit.
- Missing, stale, or failing required checks block submission.
- `SUBMITTED` freezes an immutable review revision; later edits create another revision.
- Decisions refer to a content digest, not only a mutable plugin ID.
- Approval never publishes automatically.
- Published versions are immutable; updates create a new version.
- Suspension blocks new installs without erasing history. Desktop receives advisory and revocation state for installed releases.

## System Architecture

```txt
Browser
  -> apps/marketplace (TanStack Start SSR + server functions)
     -> D1: identity, draft, scan, review, release, catalog, audit
     -> R2: assets, skill bundles, immutable review snapshots
     -> Queues: scan, notification, indexing, publication jobs
     -> Workflows: scan/submission/review/publication orchestration
     -> GitHub App: publish deterministic catalog projection

Official Cypheria marketplace repository
  -> .agents/plugins/marketplace.json
  -> approved entries using GitHub url or git-subdir + immutable sha

Cypheria Desktop
  -> Cypheria Marketplace API
  -> Codex App Server marketplace/add(Cypheria GitHub repo)
  -> marketplace/upgrade + plugin/install
  -> $CYPHERIA_HOME/codex

Other Desktop marketplaces
  -> Codex App Server plugin/list marketplace records
```

`apps/marketplace` is a separate remote trust boundary. It must not import Electron, desktop IPC, `@cypheria/runtime`, `@cypheria/codex-bridge`, or the local SQLite adapter in `@cypheria/db`. Framework-neutral schemas, API contracts, and UI primitives may move to dedicated packages once stable.

## Cloudflare Design

Use the official TanStack Start Workers integration: `@cloudflare/vite-plugin` before the TanStack Start plugin, a custom Worker entrypoint delegating HTTP to `@tanstack/react-start/server-entry`, Wrangler-generated binding types, and committed D1 migrations.

- **Workers**: SSR, APIs, auth callbacks, authorization, validation, GitHub callbacks, and webhooks.
- **D1**: system of record for publication state and query store for the public catalog.
- **R2**: private-by-default, immutable, content-addressed assets and artifacts.
- **Queues**: bounded asynchronous scan, indexing, notification, and catalog-publication jobs.
- **Workflows**: durable multi-step operations that wait on scans or human review and resume idempotently, including GitHub catalog reconciliation.
- **Cron triggers**: reconciliation, stale-draft cleanup, endpoint revalidation, and advisory refresh; not the primary publication path.

Do not run third-party hooks, shell commands, package installers, or arbitrary JavaScript in the request Worker. Static inspection may run with strict bounds. Future dynamic execution requires an isolated service with no production credentials and explicit CPU, memory, network, and time limits.

## GitHub Marketplace Projection

Cypheria operates one public GitHub repository whose `$REPO_ROOT/.agents/plugins/marketplace.json` is the Codex-installable projection of all currently published, non-suspended releases. D1 remains the source of truth for submission and review; the repository is the deterministic distribution projection consumed by App Server.

Publication uses an outbox plus a single-writer Queue/Workflow:

```txt
publisher requests publication
  -> D1 records PUBLISH_REQUESTED + outbox event
  -> worker selects every active approved release
  -> generate canonical, stably sorted marketplace.json
  -> validate every entry and content digest
  -> commit through a least-privilege GitHub App
  -> read back and verify repository blob + commit SHA
  -> record catalog_commit_sha
  -> mark release PUBLISHED and expose it through the public API
```

Concurrent jobs use an expected-head comparison and retry from the latest D1 state. Reconciliation regenerates the complete file, so retries, missed events, withdrawal, and suspension converge without hand edits. The generated branch is protected; human commits are rejected. GitHub credentials are stored as Worker secrets, never D1 or R2, and the GitHub App is limited to contents access on this repository.

Each entry contains only a reviewed GitHub `url` or `git-subdir` source pinned by `sha`, mandatory install/auth policy, category, and reviewed interface metadata. The repository does not become the review database and does not copy third-party plugin code.

The catalog commit is the publication barrier: a release is not `PUBLISHED` until the corresponding verified commit exists. Suspension or withdrawal publishes a new catalog commit that removes the entry. Already installed cached copies are not silently deleted; Desktop surfaces the Marketplace advisory and requires an explicit update or uninstall action.

V1 uses one aggregated repository as required by the App Server repo-marketplace contract. This has a known scale boundary because the current client-facing `plugin/list` response is not paginated. Desktop therefore uses the cursor-paginated Cypheria API for browsing and invokes App Server only to register/upgrade the catalog and read or install the selected plugin. Track generated JSON size, entry count, App Server refresh latency, memory, and JSON-RPC payload size. Before those budgets become unsafe, adopt an App Server paginated search method when available or version a compatible sharding strategy; do not silently truncate the catalog.

## Information Architecture And API

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

Publisher/reviewer mutations use authenticated server functions or `/api/v1/console/*` routes with CSRF protection, authorization, idempotency keys, and audit writes. The public API is versioned separately from UI loaders so Desktop never depends on route internals.

## Core Data Model

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

Policy-relevant and searchable fields remain typed columns. Bounded JSON may store versioned extension metadata, tool schemas, CSP declarations, and scan output. Every revision and release records canonical content, artifact, and manifest digests. Audit rows are append-only.

## Validation And Review

Automated checks include the ChatGPT/Codex plugin and marketplace schemas; exact GitHub public-repository and commit resolution; permitted `url`/`git-subdir` shape; contained paths; license coverage; source size and file-count bounds; malware, secrets, executable content, dependencies, and prohibited files; MCP reachability and protocol enumeration; schema quality, authentication and CSP consistency; domain proof; redirect and response bounds; tool annotation consistency; positive/negative tests; and publisher/policy ownership consistency.

Remote fetches block loopback, link-local, private, metadata-service, and DNS-rebinding targets; revalidate every redirect; enforce TLS, size, and timeout limits; and never attach Marketplace credentials. Reviewer demo secrets are encrypted, narrowly scoped, not returned after write, and removed by retention policy.

Automated checks do not equal approval. Reviewers inspect the immutable revision, findings, test evidence, permissions, data-handling declarations, diff from the last release, and prior decisions. Every decision and state transition records actor, timestamp, reason, and revision digest.

## Desktop Integration

Desktop presents one Plugins area with source-aware sections, not one flattened trust domain.

### Cypheria Marketplace provider (planned)

Electron main calls the versioned Marketplace API for paginated discovery, Cypheria review state, advisories, and the expected GitHub catalog commit. The renderer receives a strict Zod projection. Installation remains an App Server operation:

```txt
select published release
  -> verify publication, GitHub source, commit SHA, and catalog commit
  -> show source/capability/permission/auth/review summary
  -> obtain explicit approval
  -> marketplace/add official Cypheria GitHub repository if absent
  -> marketplace/upgrade and require the expected catalog commit
  -> plugin/read from the resolved local marketplace
  -> plugin/install through Codex App Server
  -> record receipt and audit event
  -> refresh plugin/skill/app/MCP inventory
```

Desktop pins the official repository URL in application configuration and does not accept a renderer-supplied replacement. It cross-checks plugin name, source URL/path/SHA, release state, and catalog commit against the Marketplace API before invoking App Server. It rejects unpublished, suspended, mismatched, stale, or incompatible entries. Update and uninstall also use App Server; Cypheria adds review/advisory checks and local audit receipts around those calls.

Cypheria Marketplace is therefore a first-class discovery and trust provider, but not a second plugin runtime or installer. Its plugins are standard ChatGPT/Codex plugins, and the official GitHub repository adapts Cypheria publication state to the existing App Server marketplace contract.

### Codex App Server provider (implemented)

Desktop already calls generated App Server methods for `plugin/list`, `plugin/read`, `plugin/install`, `plugin/uninstall`, plugin enablement through `config/value/write`, `skills/list`, `skills/config/write`, and `marketplace/add`, `marketplace/upgrade`, and guarded `marketplace/remove`.

App Server has no separate `marketplace/list` method: `plugin/list` returns the live `marketplaces[]` inventory with each marketplace's `plugins[]`. Cypheria classifies those marketplace records with trusted exact-name allowlists. Known OpenAI names, including `openai-curated-remote`, `openai-bundled`, and `openai-primary-runtime`, form OpenAI. The pinned official Cypheria marketplace identity, `cypheria-curated`, forms Public. Every remaining marketplace forms Personal, even if a user-controlled name contains `openai` or `cypheria`. Bundled and primary-runtime marketplaces are shown when returned and are otherwise optional.

`marketplace/add` accepts the App Server source string plus optional ref and sparse paths, so parsing, cloning, upgrading, and plugin installation remain App Server responsibilities. Desktop preserves provenance and partial failures, revalidates destructive operations in Electron main, and keeps state under `CODEX_HOME="$CYPHERIA_HOME/codex"`.

This is compatibility support, not the Cypheria Marketplace provider. OpenAI remote availability depends on the bundled App Server, feature flags, account, and network. Desktop must show failures truthfully and never substitute Cypheria data.

## Authentication, Operations, And Recovery

- Use OIDC with HTTP-only, `Secure`, `SameSite=Lax` sessions; CSRF protection for mutations; and step-up authentication for identity, submission, publication, suspension, and key rotation.
- Organizations have `owner`, `publisher`, `reviewer`, and `viewer` roles. Reviewer access is restricted to Cypheria-operated review organizations.
- Publisher verification is a first-class, auditable record, based on domain/organization evidence and manual review—not an email-derived badge.
- Marketplace stores no wallet keys, Desktop bearer tokens, or end-user MCP credentials. Its GitHub App private key/token is a rotated Worker secret with repository-scoped permissions.
- Structured logs exclude secrets and bundle contents. Metrics cover API health, queue lag, workflow failure, scan duration, review age, publication, download, and catalog freshness.
- Test D1 backup/restore and migration rollback. R2 lifecycle retains published artifacts and review evidence while expiring abandoned uploads and review secrets.
- Queue consumers and workflow steps are idempotent. Publication uses an outbox/event record, expected Git head, read-after-write verification, and scheduled reconciliation so D1 and the GitHub catalog cannot silently diverge.

## Delivery Sequence

1. Scaffold Workers/TanStack Start, bindings, local development, CI, and the public shell.
2. Add auth, organizations, roles, publisher verification, D1 migrations, R2 artifacts, and audit events.
3. Implement GitHub-only source verification and drafts for the Info/Skills/MCP/Prompts/Testing/Availability/Submit flow.
4. Implement bounded source/MCP scanners, Queues, Workflows, reviewer UI, decisions, and change requests.
5. Implement immutable releases, the deterministic GitHub marketplace publisher, public APIs, advisories, suspension, and withdrawal.
6. Add the Cypheria discovery/trust provider to Desktop and install through the existing App Server marketplace operations.
7. Verify submission, review, publication, installation, update, revocation, and recovery end to end.
