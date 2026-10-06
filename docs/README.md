---
title: Cypheria Documentation
---

# Cypheria Documentation

These documents describe how Cypheria is built. Each subject has one owning page; other pages link to it instead of repeating it. English is authoritative, and every page has a complete Simplified Chinese companion.

## Start here

- [Architecture](architecture.md): system boundaries, process ownership, data flow, and trust boundaries.
- [Development](development.md): toolchain, workspace, commands, generated artifacts, testing, and documentation rules.
- [Roadmap](roadmap.md): approved work that is not done yet.

## Server

- [Server runtime](server/runtime.md): process supervision, the Cypheria home, configuration, logs, HTTP operations, and authentication.
- [Protocol](server/protocol.md): transport, messages, Threads and the Canonical Timeline, turns and interactions, the client SDK, and Computer Use hosts.
- [Database](server/database.md): the SQLite schema, constraints, transactions, and migration policy.
- [Schedules](server/schedules.md): cadence, leases, recovery, and the Web3 non-replay rule.
- [Terminals](server/terminals.md): Thread and authentication terminals, binary streaming, and limits.
- [Relay](server/relay.md): the encrypted remote transport, its deployment modes, and capacity.
- [AI gateway](server/ai-gateway.md): the magpie gateway over Cypheria's Agents.

## Agents and plugins

- [Agent harnesses](agents/harnesses.md): the registry, installation, runtimes, the Codex, Claude, Pi, OpenCode, and ACP harnesses, and branching.
- [Plugins, Skills, and MCP](agents/plugins.md): the integration model, bundled plugins and Cypheria app tools, marketplaces, Codex Apps, and hooks.
- [Polyglot Plugins](agents/polyglot-plugins.md): the Agent Plugins v1 layout, format detection, native support, and per-Agent enablement.
- [Plugin Marketplaces](agents/plugin-marketplaces.md): marketplace categories, plugin identity, local storage, the marketplace lifecycle, and the database schema.
- [Agent Plugin Capabilities](agents/agent-plugin-capabilities.md): each Agent's catalogs, native formats, and commands.
- [Plugin Extensions](agents/plugin-extensions.md): the OpenAI MCP Extensions surfaces that plugins contribute, and the App sandbox.
- [Codex configuration](agents/codex-config.md): native settings, project trust, Thread launch parameters, and feature flags.
- [Codex permissions](agents/codex-permissions.md): the permission modes and how they map to Codex.
- [Codex App Server API](agents/codex-api.md): generated reference for adapter development.

## Desktop

- [Desktop](desktop/desktop.md): the Electron boundary, Server Manager, Sidebar, settings, conversation workspace, and built-in browser.
- [Composer](desktop/composer.md): trigger menus, structured references, uploads, and how input reaches an Agent.
- [Client storage](desktop/client-storage.md): device-local key/value state, rebuildable replicas, and attachment bytes.

## Features

- [Git](features/git.md): the Git service and protocol, the Review panel, pull request creation, and managed worktrees.
- [Code Review](features/code-review.md): the Code Review App, its tools over OpenAI's backend, and private reviews.
- [Computer Use](features/computer-use.md): the `cua_repl` runtime through which Agents operate browsers, MCP Apps, and desktop apps.
- [Browser extension](features/browser-extension.md): the Chromium extension and native messaging host behind the user's browsers.
- [Web3](features/web3.md): networks, wallets, signing policy, dApp sessions, and audit.

## Design

- [UI system](design/ui-system.md): visual principles, theme, shared components, and regression invariants.
- [Conversation UI](design/conversation-ui.md): the task chrome, Timeline, composer, and panels that every Agent shares.
- [Brand](design/brand.md): marks, colors, icons, and asset generation.

## Planned

- [Cypheria Marketplace](planned/marketplace.md): the planned submission, review, publication, and discovery service inside the website. Nothing in it is implemented yet.

Generated references are updated by their generators, never by hand.
