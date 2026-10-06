---
title: Polyglot Plugins
---

# Polyglot Plugins

A Polyglot Plugin is one package that loads in several Agents. Each Agent uses the package natively when the package carries a manifest that Agent reads. An Agent that reads none of the package's manifests does not support it; Cypheria does not convert a package or pass its parts to an Agent it was not written for.

Where packages come from and where they are stored is described in [Plugin Marketplaces](plugin-marketplaces.md). Each Agent's native formats and commands are listed in [Agent Plugin Capabilities](agent-plugin-capabilities.md).

## Standard foundation

The universal layout is the [Agent Plugins specification](https://github.com/agentplugins/agent-plugins-spec) v1.0.0:

- **Manifest:** `plugin.json` at the package root declares the name, version, author, license, and vendor extension namespaces.
- **Skills:** `skills/*/SKILL.md`, following the Agent Skills standard.
- **MCP servers:** `mcp.json` at the package root, with `stdio`, `streamable-http`, or `sse` servers.
- **Vendor extensions:** client-specific settings live under `extensions.<namespace>` in `plugin.json`, and vendor-owned files live in `<namespace>/`.

## Multi-format layout

One package root can carry the manifests of several Agents side by side. They share `skills/` and server code:

```text
my-polyglot-plugin/
├── plugin.json               # Agent Plugins v1 manifest
├── mcp.json                  # Portable MCP servers
├── skills/                   # Agent Skills (SKILL.md)
│   └── review-helper/
├── .codex-plugin/            # Codex manifest and OpenAI App declarations
│   └── plugin.json
├── .claude-plugin/           # Claude manifest and userConfig options
│   └── plugin.json
├── package.json              # Pi package manifest when it has a "pi" property
└── hooks/                    # Agent lifecycle hooks (hooks.json)
```

## Format detection

Server inspects the package files and records each format it finds in `detectedFormats`:

| Format | Detected by |
| :- | :- |
| `agent_plugin` | `plugin.json` at the package root |
| `codex` | `.codex-plugin/plugin.json` |
| `claude` | `.claude-plugin/plugin.json` |
| `copilot` | `.github/plugin/plugin.json` |
| `cursor` | `.cursor-plugin/plugin.json` |
| `devin` | `.devin-plugin/plugin.json` |
| `goose` | `.goose-plugin/plugin.json` |
| `gemini` | `gemini-extension.json` |
| `grok` | `.grok-plugin/plugin.json` |
| `pi` | `package.json` with a `"pi"` property |
| `cline` | `package.json` with a `"cline"` property, or any entry of `cline-official` |

Directory names alone never decide a format. In particular, `skills/`, `extensions/`, `prompts/`, or `themes/` do not make a package a Pi package, because `skills/` is also part of the universal layout.

## Native support and priority

An Agent supports a package natively when it reads one of the detected formats, as listed in [Agent Plugin Capabilities](agent-plugin-capabilities.md#capabilities-matrix). An Agent that reads both its own manifest and another format uses its own manifest:

- Codex uses `.codex-plugin/plugin.json`, then root `plugin.json`, then `.claude-plugin/plugin.json`, then `.cursor-plugin/plugin.json`.
- Claude uses `.claude-plugin/plugin.json` before root `plugin.json`.
- Goose uses `.goose-plugin/plugin.json`, then `.plugin/plugin.json`, then root `plugin.json`, then `gemini-extension.json`.
- Grok Build uses `.grok-plugin/plugin.json`, then `.claude-plugin/plugin.json`, then root `plugin.json`.
- Copilot CLI uses root `plugin.json`, then `.github/plugin/plugin.json`, then `.claude-plugin/plugin.json`.
- Pi uses `package.json` with a `"pi"` property.

An Agent that reads root `plugin.json` but finds no manifest of its own loads the package through the Agent Plugins v1 layout.

An Agent can support a package natively but not all of its components; Goose, for example, does not read `mcp.json`. Cypheria does not supply the components the Agent skips.

## Enablement lifecycle

A plugin is installed once and then enabled or disabled per Agent. Each Agent that installed it has a row in `plugin_agent_bindings`, described in [Plugin Marketplaces](plugin-marketplaces.md#database-schema).

- **Installing** installs the plugin natively in every Agent that supports it and enables it there. Agents that support it later are not enabled automatically.
- **Enablement** is independent per Agent and exists only where the Agent supports the plugin. The plugin detail page shows one switch per supporting Agent once the plugin is installed, so a plugin can run in Codex and stay off in Claude.
- **Support added later** does not enable anything. An Agent that gains native support after an update shows the plugin switched off, and turning the switch on installs it for that Agent first.
- **Uninstalling** removes the plugin natively from every Agent that holds it and deletes the bindings.

## Unsupported Agents

An Agent that reads none of the plugin's detected formats has no binding and no switch. The plugin detail page lists it as not supported, an Agent's plugin list shows the installed plugin as not supported, and Server refuses a request to enable it there. Installing a plugin that no installed Agent supports records it without enabling it anywhere.
