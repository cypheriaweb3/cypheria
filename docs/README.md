---
title: Cypheria Documentation
---

# Cypheria Documentation

This index assigns one owner to each subject. Follow links instead of copying details between documents.

## Start here

- [Architecture](architecture.md): system boundaries, ownership, data flow, and trust boundaries.
- [Development](development.md): stack, workspace, commands, generation, testing, and contribution workflow.
- [Active roadmap](todo.md): planned work only.

## Runtime and protocols

- [Server](server.md): process supervision, configuration, runtime directories, and operations.
- [Client/server protocol](protocol.md): transport, messages, domain operations, timelines, and errors.
- [Agent harnesses](agent-harnesses.md): registry, installation, runtime models, first-party harnesses, and ACP.
- [Database](database.md): current SQLite baseline and migration policy.
- [Client storage](client-storage.md): cross-platform key/value state, rebuildable replicas, and attachment bytes.
- [Composer inputs and references](composer.md): trigger menus, structured references, uploads, and submission mapping.
- [Schedules](schedules.md): cadence, leases, execution, recovery, and non-replay guarantees.
- [Terminals](terminals.md): Thread ownership, private authentication terminals, binary streaming, and lifecycle.
- [Relay](relay.md): encrypted remote transport, deployment, capacity, and observability.

## Product surfaces

- [Desktop](desktop.md): Electron boundary, Server Manager, Sidebar, conversation workspace, and local settings.
- [Computer Use](computer-use.md): the `cua_repl` runtime that lets Agents operate the built-in browser, the user's browsers, MCP Apps, and desktop apps.
- [Local Git design](git.md): Git ownership, backend selection, safety, persistence, and Agent tools.
- [Code Review](code-review.md): the Code Review MCP App, its tools over OpenAI's backend, private reviews, and Desktop surfaces.
- [Integrations](integrations.md): Skills, MCP, plugins, marketplace sources, and Codex Apps.
- [Plugin Extensions](plugin-extensions.md): plugin UI surfaces from the OpenAI MCP Extensions specification, served by the Server for every client: entry points, settings, mentions, file viewers, model context, and the Desktop App sandbox.
- [AI gateway](gateway.md): the magpie gateway over Cypheria's Agents, its release pin, lifecycle, ports, and scope.
- [Web3](web3.md): networks, wallets, policies, signing, dApps, and audit.
- [UI system](ui.md): visual principles, theme implementation, conversation components, and regression invariants.
- [Codex conversation UI reference](codex-conversation-ui-reference.md): evidence-backed task chrome, Timeline, composer, and panel behavior for shared implementation.
- [Brand](brand.md): product marks, colors, icons, and asset generation.

## Codex integration references

- [Generated Codex App Server API](codex-app-server-api.md)
- [Codex configuration semantics](codex-app-server-config.md)
- [Codex feature defaults and Desktop overrides](codex-app-server-features.md)
- [Codex permissions in Cypheria](codex-permissions.md)

## Planned service

- [Cypheria Marketplace](marketplace.md): planned dynamic submission, review, publication, and discovery capability inside Website. No Marketplace routes are implemented yet.

Every maintained English product document has a `.zh-CN.md` companion. Generated references must be updated through their generator rather than edited directly.
