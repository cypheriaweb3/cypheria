# UI System

Cypheria Desktop uses a quiet, dense, panel-oriented visual system designed for long-running technical work. The established Sidebar and conversation workspace are fidelity-critical product surfaces. This document owns visual and interaction rules; implementation boundaries remain in [Desktop](desktop.md).

## Principles

- Prioritize readable information hierarchy over decoration.
- Use low-saturation surfaces, restrained borders, and compact spacing.
- Keep primary work—conversation, diff, terminal, approval, wallet, policy, and browser context—visible without unnecessary navigation.
- Prefer mature shared primitives to custom base controls.
- Preserve keyboard and pointer parity and make focus visible.
- Avoid neon, glossy gradients, and generic Web3 marketing patterns in the application UI.

## Theme

Semantic CSS variables define background, foreground, panel, border, muted, accent, destructive, success, warning, focus, and chart roles. Components consume semantic roles rather than literal brand colors. Light and dark modes must preserve hierarchy, contrast, and state distinction.

Typography uses a readable UI stack with a dedicated monospace stack for code, commands, paths, addresses, and hashes. Density is controlled by shared spacing and size tokens, not one-off component overrides.

Persisted theme, locale, font, and layout preferences are Desktop-local settings. Shared product state must not depend on a chosen theme.

## Components

`@cypheria/ui` is the shared source for reusable primitives and AI Elements. Use shadcn-style copied components and Base UI primitives for common dialogs, menus, popovers, selects, tabs, switches, sliders, tooltips, and focus management.

Custom components are appropriate for domain-specific interactions such as:

- Agent state and compatibility;
- Timeline reasoning, plans, tools, commands, diffs, approvals, and artifacts;
- wallet and account switching;
- signing review and transaction simulation;
- policy editing;
- dApp permission and browser controls.

Shared components remain presentation-oriented. Data fetching and Electron access stay in the application layer.

## AI Elements

AI Elements provide composable conversation primitives for messages, reasoning, tools, code, plans, attachments, prompts, and streaming state. Desktop composes them inside the existing conversation shell; it does not replace established navigation, Thread scope, virtualization, scroll restoration, or harness extensions.

Timeline renderers accept Canonical Timeline items. Harness renderers are registered only for discriminated harness items or metadata with genuine additional behavior.

## Sidebar invariants

- Preserve Pinned, custom Sections, Projects, and recents in their established order and density.
- Preserve nesting, expansion, pagination, selection, context menus, drag and drop, keyboard navigation, unread state, and running state.
- Do not derive membership from visual state or harness metadata.
- Keep optimistic movement stable; rollback must restore both order and membership.
- Loading and error placeholders must not cause unrelated rows to jump.

## Conversation invariants

- Preserve a draft and scroll position per Cypheria Thread.
- Preserve temporary-to-persistent Thread transitions without losing input, attachments, or focus.
- Stream into stable item identities and maintain the user's scroll anchor.
- Never force-scroll a reader who moved away from the live edge.
- Show cancel, retry, pending interaction, and failure recovery states at the point of action.
- Render common item types consistently for every Agent.
- Keep harness-specific controls scoped and clearly attributed.

Virtualization must support variable-height content, incremental history loading, terminal output, expanded reasoning, and large diffs without corrupting restored positions.

## Accessibility and localization

- Interactive elements need accessible names, visible focus, and correct disabled state.
- Menus, dialogs, listboxes, and drag alternatives must be keyboard operable.
- Status must not rely on color alone.
- Respect reduced motion and platform text scaling where supported.
- English and Simplified Chinese UI strings use Lingui and must compile without missing required messages.
- Layouts must tolerate longer translations without truncating essential actions.

## Visual verification

Changes to Sidebar, composer, Timeline, approvals, diff, terminal, wallet, or browser chrome require focused interaction tests and visual review in both themes. Compare behavior at common window sizes and under streaming, loading, empty, error, and long-content states.

The acceptance threshold is no regression in the existing Codex experience and equivalent shared behavior for Claude, Pi, OpenCode, and ACP.
