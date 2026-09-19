# Cypheria Documentation

> Status: Current implementation index

This index assigns one owner to each subject. Follow links instead of copying details between documents.

## Start here

- [Architecture](architecture.md): system boundaries, ownership, data flow, and trust boundaries.
- [Development](development.md): stack, workspace, commands, generation, testing, and contribution workflow.
- [Active roadmap](todo.md): planned work only.

## Runtime and protocols

- [Server](server.md): process supervision, configuration, runtime directories, and operations.
- [Client/server protocol](protocol.md): transport, messages, domain operations, timelines, and errors.
- [Agents](agents.md): registry, installation, runtime models, first-party adapters, and ACP.
- [Database](database.md): current SQLite baseline and migration policy.
- [Schedules](schedules.md): cadence, leases, execution, recovery, and non-replay guarantees.
- [Relay](relay.md): encrypted remote transport, deployment, capacity, and observability.

## Product surfaces

- [Desktop](desktop.md): Electron boundary, Server Manager, Sidebar, conversation workspace, and local settings.
- [Integrations](integrations.md): Skills, MCP, plugins, marketplace sources, and Codex Apps.
- [Web3](web3.md): networks, wallets, policies, signing, dApps, and audit.
- [UI system](ui.md): visual principles, theme implementation, AI Elements, and regression invariants.
- [Brand](brand.md): product marks, colors, icons, and asset generation.

## Provider references

- [Generated Codex App Server API](codex-app-server-api.md)
- [Codex configuration semantics](codex-app-server-config.md)
- [Codex permissions in Cypheria](codex-permissions.md)

## Planned service

- [Cypheria Marketplace](marketplace.md): planned remote submission, review, publication, and discovery service. This is not an implemented application yet.

Every maintained English product document has a `.zh-CN.md` companion. Generated references must be updated through their generator rather than edited directly.
