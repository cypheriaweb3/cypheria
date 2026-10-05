---
title: Roadmap
---

# Roadmap

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
- [ ] Publish Claude-format releases after their manifest, scanning, installation, and trust contracts exist.

The detailed future service boundary and threat model are in [Marketplace](planned/marketplace.md).

## Plugin experience

- [ ] Complete remaining Desktop plugin experience.
  - Add Skill recording where supported.
  - Complete loading, empty, error, disabled, update, advisory, and permission states.
  - Verify authenticated connector authorization in packaged Electron builds.
  - Complete the [Plugin Extensions limits](agents/plugin-extensions.md#limits): render-only Apps of Claude tool calls and App-only tool hiding for Claude, Expo and CLI hosting, form uploads, and implicit resource selection.
  - Verify the Desktop App sandbox end to end with the Bits & Bolts plugin in development and packaged Electron builds: entry points, the global page's workspace thread, file viewers, model context, messages, settings, mentions, and forms.
  - Define the Cypheria-native manifest and the permission model for third-party `cypheria/*` host requests.
  - Add Pi and OpenCode plugin adapters as custom sources, and support marketplaces hosted on claude.ai for Claude.

## Local Git and pull requests

- [ ] Verify Code Review against OpenAI's backend with a real ChatGPT account: GitHub and GitLab connections (including several accounts), inbox sections, detail reads, writes, checks, and private reviews, and confirm the GitLab response shapes.
- [ ] Verify Create PR end to end: with a signed-in `gh`, with the GitHub and GitLab accounts linked in ChatGPT (confirming the `github.create_pull_request` and `gitlab.create_merge_request` argument and result shapes), and through the browser pages.

## Built-in browser

- [ ] Verify the built-in browser end to end in development and packaged Electron builds: tab residency and screenshots of parked tabs, Agent commands, popups, and the dApp provider smoke test.
- [ ] Measure whether `document.cookie` in third-party frames bypasses the dApp cookie filter, and add bounce-tracking protection for the shared dApp profile.
- [ ] Add dApp tab controls for connected accounts, disconnect, and permission revocation once the Server exposes per-origin permission management.

## Computer Use

The design is in [Computer Use](features/computer-use.md) and [Browser extension](features/browser-extension.md).

- [ ] Verify end to end with Codex and Claude Threads, in development and packaged Desktop builds.
  - `iab` and `mcpapps`, including MCP App screenshots and actions.
  - `chrome` with `extension` and with `cdp`, on Chrome and Edge, and the extension on macOS, Windows (named pipe and registry keys), and Linux.
  - `computer` with the embedded cua-driver daemon and its macOS grants, and with ChatGPT Computer Use, including an app approval answered from a second client and a computer audio recording.
  - `tab.content` exports of a Google document and a YouTube transcript in a signed-in browser; Google shows headless test browsers a bot check.
- [ ] Ship the extension: build the host for every platform in CI (`pnpm --filter @cypheria/browser-extension-host build:all`), copy it into Desktop builds under `resources/browser-extension-host/<platform>-<arch>/`, sign and notarize it with Desktop, publish the extension to the Chrome Web Store and Edge Add-ons, and add the store IDs to `EXTENSION_IDS` and the host's `allowedIDs` build flag.
- [ ] Bundle the fetched cua-driver executable outside ASAR and sign it with the Desktop app once Desktop packaging exists.
- [ ] Give Pi, OpenCode, and ACP Agents the `cua_repl` server through their harness adapters, with the same per-Thread host as Codex and Claude.
- [ ] Ask before an Agent first operates a desktop app through cua-driver or claims an external browser tab, through the `computer.host.approval.request` questions that ChatGPT Computer Use already raises, and remember per-app and per-site decisions across Threads.
- [ ] Publish built-in browser tab metadata through the Server, so every client's Browser panel and composer mentions show a Thread's tabs on other devices.
- [ ] Broadcast Computer Use activity per Thread (device, target, action) with a stop control on every client.
- [ ] Mount MCP Apps on demand in a parked layer, so an Agent can operate a Thread's App that no window currently shows.
- [ ] Arbitrate native app control between Threads acting on the same device.

## Codex desktop parity

- [ ] Declare the `cypheria://` URL scheme in each platform's packaged-app manifest, so links from other applications reach an installed Desktop; development builds register it at startup.
- [ ] Port the official instruction sections that need client features Cypheria lacks: workspace dependencies, LaTeX, running summaries, writing blocks, non-technical UI, and heartbeat cards.
- [ ] Carry the Agent-side tools the official desktop mounts but Cypheria does not yet: `set_thread_read_state`, `get_thread_emoji`, `set_thread_emoji`, `create_project`, `list_hosts`, `read_settings`, `write_settings`, `get_usage_limits`, and `consume_usage_reset`.

## Desktop

- [ ] Remove the Chat Demo now that the production conversation workspace uses the shared chat components.
  - Delete `chat-demo.tsx`, `chat-demo-files.tsx`, their test, and the `chat-demo` route; remove the Sidebar item and its development-item filtering; and, if nothing else uses them, `development-mode.ts`, `bootstrap.development`, and their main and preload wiring. Regenerate `routeTree.gen.ts` with `pnpm --filter @cypheria/desktop build:renderer`.
  - Keep `packages/ui/src/components/chat`, the complete icons mirror, and the conversation UI reference; they are production assets.
  - Remove the Chat Demo mentions from the documentation.

## Expo

Expo currently remains a buildable client foundation. Mobile product work will be planned after the Desktop experience is mature; no unapproved feature checklist is maintained here.
