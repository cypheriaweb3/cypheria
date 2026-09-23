---
title: Integrations
---

# Integrations

> Planned: Cypheria-native plugin execution is not yet complete.

The Server presents Skills, MCP servers, plugins, marketplaces, and Codex Apps through one integration facade while preserving each harness's provenance and semantics.

## Common model

Every integration view carries an owning Agent and optional native identifier. Compatibility tags declare support for `codex`, `claude`, `pi`, `opencode`, or the ACP compatibility bucket. The Server validates compatibility before enablement or launch; clients show compatible, incompatible, and Agent-specific states.

Harness records are normalized for presentation, but mutation is routed back to the owning Agent adapter. Cypheria does not claim that one ecosystem supports another ecosystem's installation or trust model.

## Skills

Skills are reusable instruction bundles. The API reports display metadata, scope, path, dependency count, enablement, harness, plugin membership, and compatibility. Skills are treated as cross-Agent concepts when their content and harness support permit it; Agent-only Skills carry the corresponding compatibility tag.

Filesystem discovery and enablement are Server responsibilities. Clients never scan harness homes directly.

## MCP

MCP servers are also a common concept. The integration API reports tools, resources, authentication state, runtime state, enablement, plugin membership, and compatibility. It supports listing, adding URL-based servers, changing enablement, and starting harness-supported login flows.

Transport credentials and OAuth state stay in the Server or harness runtime. MCP elicitation enters the common Thread interaction lifecycle.

## Plugin ecosystems

`ecosystem` identifies the plugin contract:

- `cypheria`: Cypheria-native manifest and contribution points;
- `openai`: ChatGPT/Codex plugin format;
- `claude`: Claude plugin ecosystem;
- `pi`: Pi extensions;
- `opencode`: OpenCode plugins.

Plugin views retain source type, marketplace identity, install policy, availability, version, capabilities, compatibility, and harness provenance. Listing, detail, install, uninstall, and enablement operations are implemented through harness adapters where the harness supports them.

Cypheria-native plugins are a separate contract. The intended manifest declares Server entry points, Desktop UI contributions, optional future Expo contributions, permissions, compatible Cypheria versions, and contribution points. Server code must run in a controlled child process. Desktop contributions must be sandboxed and receive scoped host APIs rather than Node.js, filesystem, database, or secret access. Completing this runtime and UX remains planned work.

## Marketplace sources

Marketplace source and plugin ecosystem are independent fields. Source kinds are `cypheria`, `openai`, `claude`, `pi`, `opencode`, and `custom`. A custom marketplace must still declare the ecosystem of every plugin it contains.

The current integration facade supports harness-owned marketplace listing, add, upgrade, and removal operations. It retains marketplace name and path so similarly named plugins from different sources do not collapse into one identity.

The independent public Cypheria Marketplace service is planned and documented separately in [Marketplace](marketplace.md). Its absence does not change harness-native or custom marketplace support.

## Codex Apps

Apps follow the OpenAI App Server/connector model and belong exclusively to the Codex harness extension. They are exposed through `client.harnesses.codex.apps`, including list, enablement, connect, callable/accessibility state, install URL, and plugin association.

Desktop opens an App's install URL in the system browser. When focus returns, it refreshes App and MCP availability; the external page does not send a trusted local completion callback.

Apps are not renamed into a universal Agent feature. If another harness later offers an equivalent capability, it receives its own harness extension and terminology.

## Caching and refresh

The Server may cache harness lists, but callers can request a refresh where the protocol exposes it. Mutations invalidate the relevant harness and integration views. Clients use the returned authoritative view rather than guessing the result of a harness-native operation.

## Security rules

- Validate manifests, identifiers, URLs, marketplace locations, and compatibility metadata.
- Preserve ecosystem, marketplace source, and harness provenance in storage and UI.
- Require explicit permissions for native plugin contributions.
- Do not expose harness credentials or host filesystem access to renderer extensions.
- Treat remote descriptions, icons, prompts, tools, and plugin code as untrusted content.
- Keep installation and execution in the Server; clients only request scoped operations.
