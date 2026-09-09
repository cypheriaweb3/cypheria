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

`react-jsx-parser` and `ansi-to-react` can resolve as nested CommonJS module objects under NodeNext
and Vite even though their eventual default exports are React components. Keep the narrow local
`resolveComponent` adapter at the render boundary so it unwraps those default exports at runtime;
do not replace it with a type-only cast or weaken TypeScript settings for the package.

### XYFlow styles

Import `@xyflow/react/dist/style.css` from `packages/ui/src/styles.css`, not from `canvas.tsx`.
NodeNext does not provide a declaration for the component-level side-effect CSS import, while the
shared stylesheet is already the package's public styling entry point.

### Desktop composer ownership

AI Elements supplies the prompt-input state, attachment validation, speech input, and submission
plumbing, but the desktop workspace owns the composer layout and interaction density. The current
layout was checked against ChatGPT Desktop 26.901.51231 (build 8109): the conversation and composer
inherit one `--thread-content-max-width` (`48rem`) and the same toolbar padding rather than keeping
independent fixed widths. A borderless 20-pixel-radius surface uses the desktop composer elevation,
the text editor occupies its own top row, and explicit
leading and trailing footer groups prevent controls from spreading across the available width.
Empty attachment chrome must not reserve a header row. The editor grows with its contents up to
`25dvh`, then becomes the only scrolling surface inside the composer.

The leading group contains context, skills, project, and permission controls. The trailing group
contains a single model/reasoning menu, dictation, active-turn steer/queue actions when applicable,
and the circular submit/stop control. Model and reasoning radio-group labels must remain inside the
corresponding Base UI `Menu.RadioGroup`; rendering a `Menu.GroupLabel` outside a group throws at
runtime even though the composition type-checks. The idle submit control is disabled for an empty
prompt without attachments, becomes an arrow action for a valid prompt, and changes to the explicit
stop state while generation is active.

Do not rely on platform-default scrollbar colors. ChatGPT keeps the macOS overlay scrollbar
geometry but sets a transparent track and a quiet thumb that strengthens on hover or active scroll.
Cypheria mirrors that behavior through the shared `scrollbar-color` tokens on standard overflow
utilities and the explicit `cypheria-scrollbar` class. Avoid forcing WebKit scrollbar widths: doing
so replaces the native overlay behavior and leaves permanent gutters that ChatGPT Desktop does not
show.

### Conversation scrolling ownership

The desktop chat must pass a Cypheria-owned external `instance` to AI Elements `Conversation`.
`Conversation` still constructs its default `use-stick-to-bottom` hook, but the default hook's refs
are not attached to the DOM when the external instance is selected, so its spring animation and
resize observer remain inactive. Keep `initial={false}` and `resize="instant"`, and keep native CSS
scroll anchoring disabled on the scroll viewport. An AI Elements refresh must not silently restore
the default smooth initial/resize behavior for the desktop workspace.

TanStack Virtual owns message virtualization and measured-height correction. Message IDs are stable
row keys; end anchoring and append following are enabled; and ResizeObserver measurements are
scheduled through animation frames. A renderer-owned LRU retains at most 20 thread states keyed by
thread ID. Each state records the raw offset, distance from the bottom, whether the viewport was at
the bottom, viewport height, the first visible stable message plus its viewport-relative offset,
and TanStack's measured-row snapshot. Restoration runs in a layout effect before paint: it prefers
the stable message anchor while the reader is away from the bottom, falls back to bottom-relative
distance when the anchor is unavailable, and follows the true bottom for a new or bottom-locked
thread. A separate immediate resize observer covers layout outside the virtualizer's measurement
root, including conversation padding and late media layout, but writes only while bottom following
is active so it cannot drag a reader away from an earlier turn.

This mirrors the renderer-owned `ThreadScope` behavior inspected in ChatGPT Desktop
26.901.51231 (build 8109), while using TanStack Virtual's public measurement snapshot and end-anchor
features instead of ChatGPT's private virtualizer. On macOS, closing the main window hides it rather
than destroying the renderer; activating the app shows the same window, so the in-memory thread
scope and scroll state survive. A real application quit intentionally clears this session-only
state.

## Upgrade Review Checklist

- Confirm the registry component count and inspect added or removed files.
- Confirm `packages/ui/package.json` still exports `./ai-elements/*`.
- Confirm existing shared primitives were not unintentionally overwritten.
- Check whether Base UI moved preview-card delays or changed event signatures.
- Check whether AI SDK changed `LanguageModelUsage`, tool descriptions, or UI part types.
- Check whether `react-jsx-parser` and `ansi-to-react` fixed their NodeNext declarations before
  removing the local adapters.
- Confirm the desktop still supplies the external Conversation instance and that regenerated
  defaults cannot re-enable spring scrolling or duplicate resize anchoring.
- Confirm the desktop composer still owns its grouped footer, `25dvh` editor cap, combined
  model/reasoning menu, and submit/stop states; open every Base UI menu in a production build.
- Confirm shared overflow surfaces retain native overlay geometry, transparent tracks, and the
  stronger hover/active scrollbar thumb in both light and dark themes.
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
