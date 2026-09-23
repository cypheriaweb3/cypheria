---
title: Active Roadmap
---

# Active Roadmap

> Status: Planned work only

This page contains incomplete, still-approved work. Completed work and architecture history belong in Git. Items are ordered by dependency and should be implemented as reviewable, testable changes.

## CLI

- [ ] Add interactive Thread execution and Web3 administration commands.
  - Support streaming output and JSONL events.
  - Cover wallet, network, policy, approval, audit, and diagnostics operations only through shared Server APIs.
  - Preserve non-interactive operation and reliable exit codes; do not add a TUI.

## Cypheria Marketplace

- [ ] Add Marketplace dynamic routes to `apps/website` without changing the static-first marketing and documentation delivery model.
  - Add localized public SSR plus authenticated publisher and reviewer surfaces, Cloudflare bindings, D1 migrations, tests, and local preview.
  - Keep Marketplace services independent of Electron, Desktop IPC, Server runtime internals, Agent SDKs, and `@cypheria/db`; run scanners in a separate restricted Worker.
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

## Local Git and pull requests

- [ ] Complete the ChatGPT Desktop local Git operation inventory in Server, including repository queries, guarded Review mutations, turn diffs, worktree ownership and handoff, cache invalidation, and persisted Git settings.
- [ ] Complete GitHub PR routing between the `gh` CLI and connected GitHub App tools according to operation, access, and available tool scopes; add the Desktop PR workflow and recovery states.
- [ ] Complete GitLab MR actions through the connected GitLab App tools with connector, account link, tool scope, project, and URL validation; retain the browser form creation path where needed.
- [ ] Verify packaged Electron Connect behavior and GitHub/GitLab authorization and PR/MR calls in Cypheria's managed Codex home.

## Expo

Expo currently remains a buildable client foundation. Mobile product work will be planned after the Desktop experience is mature; no unapproved feature checklist is maintained here.
