# AI Elements Integration And Upgrade Guide

Cypheria vendors the complete AI Elements registry into `packages/ui/src/components/ai-elements`.
The components are shared UI source, not an opaque runtime dependency, and are exported as
`@cypheria/ui/ai-elements/*`.

## Current Integration

- Registry: `ai-elements@latest`
- Installed components: all registry components (48 files at the time of installation)
- Install directory: `packages/ui/src/components/ai-elements`
- Shared primitives: `packages/ui/src/components`, using `base-nova` in both registry configs
- Package export: `@cypheria/ui/ai-elements/<component>`
- Styling entry point: `@cypheria/ui/styles.css`

AI Elements dependencies belong to `@cypheria/ui`. The workspace-level React type overrides in
`pnpm-workspace.yaml` keep dependencies that bundle React 18 declarations on the workspace's React
19 type version.

The 48 components have been reinstalled against Nova. AI Elements uses one registry rather than a
separate Nova variant: its controls inherit the local Nova primitives, while component-specific
typography remains intact. Reinstallation alone does not replace the compatibility adaptations below.

## Upgrade Procedure

1. Start with a clean or reviewed working tree so generated changes can be audited.
2. From `packages/ui`, run:

   ```sh
   pnpm dlx ai-elements@latest
   ```

3. Install every registry component. Do not overwrite existing shared shadcn/Base UI primitives
   without reviewing their Cypheria-specific implementation.
4. Review dependency changes in `packages/ui/package.json` and `pnpm-lock.yaml`.
5. Reapply or verify every compatibility adaptation below.
6. Format and verify the workspace:

   ```sh
   pnpm format
   pnpm --filter @cypheria/ui typecheck
   pnpm --filter @cypheria/desktop typecheck
   pnpm run ci
   pnpm build
   ```

Do not use `--overwrite` blindly. AI Elements may request shadcn primitives that already exist in
`packages/ui/src/components`; replacing them can change Base UI behavior across the desktop app.

For a deliberate full reinstall, the equivalent shadcn command from `packages/ui` is:

```sh
pnpm exec shadcn add https://elements.ai-sdk.dev/api/registry/all.json --yes --overwrite
```

Before running it, snapshot the reviewed shared primitives. Afterwards, compare and restore their
local adaptations from that snapshot (not from HEAD when the working tree contains changes), then
reapply the AI Elements adaptations. Preserve local test files, the theme stylesheet, and desktop
font-size overrides. Run `pnpm --filter @cypheria/ui test` and desktop tests as well as CI/build.

## Compatibility Adaptations

### NodeNext imports

`@cypheria/ui` uses `moduleResolution: NodeNext`. Relative imports between AI Elements files must
include the emitted `.js` extension, for example `./code-block.js`, `./shimmer.js`, and `./tool.js`.

### Base UI hover cards

AI Elements models `openDelay` and `closeDelay` as root hover-card properties. Base UI 1.x exposes
the equivalent `delay` and `closeDelay` properties on `PreviewCard.Trigger`. Cypheria's shared
`HoverCard` stores root delay values in context, and `HoverCardTrigger` forwards them to Base UI.
Preserve this adapter when regenerating either hover-card consumers or the shared primitive.

### Base UI events and render composition

- Infer menu and button event types from the local Base UI-backed components instead of using DOM
  `Event` or plain React mouse-event annotations.
- Put `CollapsibleTrigger` properties on the trigger itself. Do not spread them into the rendered
  `Button`, because Base UI render-state types differ.
- Forward both arguments of Base UI `Dialog.onOpenChange`, while updating the controlled state with
  the boolean value.
- Compose tooltip action buttons and context preview triggers with `render`, not a trigger wrapping
  another interactive element. Preserve keyboard activation, disabled state, and custom context
  trigger elements.

### Base UI state styling

Use Base UI attributes instead of Radix `data-state` selectors: collapsible roots/panels expose
`data-open` / `data-closed`, collapsible triggers expose `data-panel-open`, and active tabs expose
`data-active`. Arrow selectors must target the appropriate group (root or trigger); a closed trigger
is the absence of `data-panel-open`. Keep these mappings when regenerating animations and tab styles.

### AI SDK usage fields

With AI SDK 7, read reasoning tokens from `usage.outputTokenDetails.reasoningTokens` and cached input
tokens from `usage.inputTokenDetails.cacheReadTokens`. A tool description can be a function; render
it only when it is a string.

### Strict TypeScript checks

Cypheria enables `noUncheckedIndexedAccess` and `noImplicitReturns`. Keep guards/defaults for regular
expression groups, array indexing, speech-recognition results, and parsed stack-frame paths. Effects
with conditional cleanup must explicitly return `undefined` on the path without cleanup.

### Third-party JSX component declarations

`react-jsx-parser` and `ansi-to-react` can resolve as module objects under NodeNext even though their
runtime default exports are React components. Keep the narrow local `ComponentType` adapters at the
render boundary; do not weaken TypeScript settings for the package.

### XYFlow styles

Import `@xyflow/react/dist/style.css` from `packages/ui/src/styles.css`, not from `canvas.tsx`.
NodeNext does not provide a declaration for the component-level side-effect CSS import, while the
shared stylesheet is already the package's public styling entry point.

## Upgrade Review Checklist

- Confirm the registry component count and inspect added or removed files.
- Confirm `packages/ui/package.json` still exports `./ai-elements/*`.
- Confirm existing shared primitives were not unintentionally overwritten.
- Check whether Base UI moved preview-card delays or changed event signatures.
- Check whether AI SDK changed `LanguageModelUsage`, tool descriptions, or UI part types.
- Check whether `react-jsx-parser` and `ansi-to-react` fixed their NodeNext declarations before
  removing the local adapters.
- Check whether the React type overrides are still required with `pnpm why @types/react -r`.
- Run UI and desktop typechecks before the full CI/build commands.

## Regression Tests And Attribution

`packages/ui/src/components/ai-elements/compatibility.test.tsx` adapts relevant cases from the
upstream AI Elements test suite and adds Cypheria-specific assertions for Base UI, NodeNext, strict
index access, AI SDK 7, and safe schema-path rendering. The upstream tests are licensed under
Apache-2.0; keep the source URL in the test file when updating or expanding these adapted cases.

Do not copy the upstream suite mechanically. Upstream tests can assume different shadcn primitives,
AI SDK versions, or browser mocks. Select the tests related to changed components, adapt imports and
fixtures to Cypheria, then add assertions for each local compatibility adapter.

`nova-compatibility.test.tsx` additionally covers single-button tooltip composition, keyboard and
disabled behavior, context triggers, Nova selector typography, prompt submission/stopping, and
sandbox collapse/tab state styling.
