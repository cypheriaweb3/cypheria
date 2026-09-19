# Active Roadmap

> Status: Planned work only

This page contains incomplete, still-approved work. Completed work and architecture history belong in Git. Items are ordered by dependency and should be implemented as reviewable, testable changes.

## CLI

- [ ] Add interactive Thread execution and Web3 administration commands.
  - Support streaming output and JSONL events.
  - Cover wallet, network, policy, approval, audit, and diagnostics operations only through shared Server APIs.
  - Preserve non-interactive operation and reliable exit codes; do not add a TUI.

## Cypheria Marketplace

- [ ] Scaffold `apps/marketplace` as a TanStack Start application on Cloudflare Workers.
  - Add locale-prefixed SSR routes, Cloudflare bindings, D1 migrations, shared UI primitives, tests, and local preview.
  - Keep the application independent of Electron, Desktop IPC, Server runtime internals, Agent SDKs, and `@cypheria/db`.
- [ ] Implement identity, organizations, authorization, publisher verification, CSRF protection, rate limits, step-up operations, and append-only audit.
- [ ] Implement public GitHub source verification, immutable-SHA plugin drafts, license coverage checks, validation, and submission.
- [ ] Implement bounded scanning and reviewer workflow with durable jobs, immutable evidence, change requests, rejection, approval, suspension, and withdrawal.
- [ ] Implement explicit publication, localized discovery, the public `/api/v1`, advisories, deterministic official catalog synchronization, reconciliation, and rollback.
- [ ] Add the Cypheria Marketplace discovery and trust integration to Desktop.
  - Pin official repository identity and catalog commit.
  - Preserve source and ecosystem provenance.
  - Obtain capability approval and install through the Codex harness operations.

The detailed future service boundary and threat model are in [Marketplace](marketplace.md).

## Plugin experience

- [ ] Complete remaining Desktop plugin experience.
  - Add Skill recording where supported.
  - Complete loading, empty, error, disabled, update, advisory, and permission states.
  - Verify authenticated connector authorization in packaged Electron builds.
  - Finish the Cypheria-native plugin process, permission, and Desktop contribution contract described in [Integrations](integrations.md).

## Expo

Expo currently remains a buildable client foundation. Mobile product work will be planned after the Desktop experience is mature; no unapproved feature checklist is maintained here.
