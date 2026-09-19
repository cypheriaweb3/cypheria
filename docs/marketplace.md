# Cypheria Marketplace

> Status: Planned; `apps/marketplace` does not exist

The planned Cypheria Marketplace is a separate public service for plugin submission, scanning, review, publication, discovery, and trust metadata. It is not the Server integration service and is not required for harness-native or custom marketplaces described in [Integrations](integrations.md).

## Product boundary

The service is planned as a TanStack Start application on Cloudflare Workers with three surfaces:

- a public, localized catalog;
- a publisher console for drafts, validation, submission, releases, and advisories;
- a reviewer console for evidence, findings, decisions, suspension, and audit history.

It must not import Electron, Desktop IPC, `apps/server` internals, `@cypheria/db`, Agent SDKs, wallet keys, or local Cypheria application data.

## Plugin contract

Initial publication targets the public ChatGPT/Codex plugin specification. A plugin root contains `.codex-plugin/plugin.json` and may contain Skills, hooks, app declarations, MCP declarations, and assets. This makes published releases installable through the existing Codex harness integration while preserving `ecosystem: openai` provenance.

Cypheria-native, Claude, Pi, and OpenCode ecosystem publication can be added only when their manifest, scanning, installation, and trust contracts are implemented explicitly. The marketplace source remains `cypheria`; ecosystem is a separate field.

## Source policy

Initial submissions accept only public open-source GitHub sources:

- `url` for a plugin at repository root;
- `git-subdir` for a contained monorepo path.

Every release pins a full immutable commit SHA. Paths must remain inside the repository. Validation rejects private repositories, moving-only references, required Git LFS pointers, unsafe submodule indirection, missing plugin manifests, and licenses that do not cover the submitted path.

Publisher identity and repository relationship are verified separately from open-source license coverage.

## Review and publication

Submission freezes an immutable source revision. Bounded scanners produce structured evidence for manifest shape, secrets, dangerous code patterns, dependency risk, declared capabilities, MCP endpoint behavior, redirects, SSRF, tool annotations, CSP, and policy URLs.

Approval and publication are separate actions. A reviewer can request changes, reject, approve, suspend, or withdraw. An approved publisher explicitly publishes a release. Any review-relevant content change requires a new version and review cycle.

Every transition is authorized on the Server side and recorded in an append-only audit log.

## Planned platform

- Cloudflare Workers for request handling and SSR;
- D1 for accounts, organizations, drafts, review state, releases, and audit records;
- R2 for immutable snapshots, evidence, and public assets;
- Queues and Workflows for bounded scanning and publication jobs;
- KV only for disposable caches and rate-limit assistance;
- external OIDC and GitHub verification for identity and source ownership.

Plugin code is never executed inside the web Worker. MCP scanning uses isolated, egress-restricted execution with strict time and size limits.

## Official catalog delivery

Publication deterministically aggregates active releases into the official Cypheria GitHub marketplace catalog. Entries use stable ordering and SHA-pinned `url` or `git-subdir` sources. Publication verifies the resulting commit before exposing the release through `/api/v1` and localized catalog pages.

Desktop's planned Cypheria Marketplace integration will:

1. fetch catalog and trust metadata from the Marketplace API;
2. pin the official repository identity and expected catalog commit;
3. register or upgrade the catalog through Codex App Server marketplace operations;
4. verify plugin source URL, path, SHA, capabilities, and approvals;
5. install through the Codex harness's plugin operation.

Discovery trust and installation execution remain distinct. OpenAI and user-added marketplaces retain their own provenance and are not relabeled as Cypheria-reviewed.

## Security requirements

- Organization-scoped authorization and step-up checks for sensitive actions.
- CSRF protection, rate limits, replay-safe identity challenges, and session rotation.
- Immutable source and evidence digests.
- No end-user connector credentials or MCP traffic proxying.
- No arbitrary plugin execution in the catalog service.
- No payments, tokens, ratings, or on-chain registry in the initial release.
- Suspension, advisory, withdrawal, reconciliation, and publication rollback paths.

## Delivery stages

1. Scaffold the Worker, localized SSR, bindings, migrations, and tests.
2. Add identity, organizations, roles, publisher verification, and audit.
3. Add source verification, drafts, validation, and submission.
4. Add isolated scanning and reviewer workflow.
5. Add publication, public catalog API, and deterministic GitHub synchronization.
6. Add the Desktop discovery and trust integration.

Only incomplete work is tracked in [Todo](todo.md).
