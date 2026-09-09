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
inherit one `--thread-content-max-width` and the same toolbar padding rather than keeping independent
fixed widths. Like the packaged desktop, Cypheria leaves Electron's `defaultFontSize` and
`defaultMonospaceFontSize` unset, keeps Chromium's 16-pixel rem baseline, and uses the source-matched
`48rem` (768-pixel) shared column.
Visual typography remains independently controlled by pixel-valued Tailwind tokens such as the
14-pixel `--font-sans-size`; changing UI text size must not rescale rem-based layout geometry. A
borderless 20-pixel-radius surface uses the desktop composer elevation,
the text editor occupies its own top row, and explicit
leading and trailing footer groups prevent controls from spreading across the available width.
Empty attachment chrome must not reserve a header row. The editor grows with its contents up to
`25dvh`, then becomes the only scrolling surface inside the composer.
Composer surfaces and submit/stop states use Tailwind semantic theme utilities (`card`,
`foreground`, `primary`, and their paired foreground tokens). Do not restore literal color values
in the workspace stylesheet: they break custom themes and make light/dark parity accidental.
Attachment affordances follow the selected model's App Server-advertised input modalities. Images
and the provider's supported audio media types are accepted only when that model advertises them;
video, document, and other file types must not appear accepted and then be silently omitted from
the turn input.

The packaged desktop keeps prompt drafts outside the mounted composer. Its
`composer-prompt-drafts-v2` store updates the current client scope and durable conversation alias
together, with a 250 ms delayed persistent write. Cypheria mirrors that lifecycle by making the
retained chat scope own the current prompt text and adapting `PromptInputProvider` to report every
edit and successful-submit clear back to that scope. New-chat and durable thread aliases point to
the same draft, so route navigation and a renderer restart restore the exact unsent text while a
submitted prompt cannot reappear. Cypheria deliberately bounds the persistent renderer store to
100 aliases; only the 20 retained chat scopes keep live `Chat` objects, so total thread history does
not translate into unbounded renderer memory. Matching the packaged scope view state, blob-backed
attachments also belong to the retained chat scope: they survive route navigation with their live
preview URL, but remain session-only and are never serialized as invalid object URLs. Explicit
removal and successful submission revoke them immediately; LRU eviction disposes any remaining
attachment URLs.

Paste routing follows the packaged editor rather than the browser textarea default. Image-only
clipboard payloads become attachments, while an image plus genuinely independent plain text stays
on the text-paste path instead of duplicating both representations. Plain text at or above 5,000
characters becomes a `Pasted text.txt` card with a first-line preview; content up to 25,000
characters can be restored at the active textarea selection through **Show in text field**. The
card and its blob URL remain scope-owned like other draft attachments. App Server v2 does not
expose a generic file input, so Cypheria preserves the desktop interaction while adapting the
payload at the privileged boundary: the AI SDK provider decodes inline `text/*` bytes for an
initial `turn/start`, and Electron main decodes the same validated data URL for `turn/steer` and
`thread/queue/add`. The model therefore receives the complete paste instead of a silently dropped
document placeholder.

User turns follow the installed desktop's compact bubble geometry: the bubble is capped at 77% of
the conversation column and uses the shared secondary surface, a large radius, and tight padding.
Assistant turn activity is intentionally flatter than the upstream AI Elements `Task` default.
Completed work collapses to one quiet duration row and short activity summaries; expanded command,
reasoning, and file details use measured, non-animated collapsibles. Do not reintroduce Task's
slide/fade height animation inside a TanStack Virtual row because intermediate animated heights
compete with row measurement and make the reading anchor drift.

Generated-image items and Markdown images in a restored final answer must resolve to the same
managed media. Renderer Markdown rewrites only paths beneath Codex's `generated_images` namespace
to `cypheria://media/generated-images/...`; Electron main resolves that suffix beneath the active
Cypheria-managed Codex home, verifies path containment and a supported raster-image extension, and serves it through
the privileged protocol. Unrelated local paths, traversal attempts, and non-image files remain
unavailable. This keeps cold-restored image answers useful without granting Markdown arbitrary
filesystem reads.

An App Server `agentMessage` with `delivery: "async"` is a mid-turn question, not a final answer.
Match ChatGPT Desktop's projection by splitting its `questions` into a dedicated question panel,
showing numbered options plus a free-form reply, and steering the active turn with the structured
`send_user_message_question_reply` envelope. A single option waits 180 ms before submission so the
selected state is visible. Completed or historical async messages remain quiet commentary instead
of rendering the server's fallback Markdown option list. The fixed active-turn progress chip counts
only distinct `fileChange` paths in that turn; workspace artifacts from older turns must not leak
into it. On hydration, a structured reply is kept out of the visible user-message sequence only
when its question ID matches an async question in the same turn; the underlying item remains in the
turn snapshot, and look-alike user-authored markup is not hidden.

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
scheduled through animation frames. A renderer-owned scroll-state LRU retains at most 20 threads.
Each state records the raw offset, distance from the bottom, whether the viewport was at the bottom,
viewport height, the first visible stable message plus its viewport-relative offset, and TanStack's
measured-row snapshot. Restoration runs in a layout effect before paint: it prefers the stable
message anchor while the reader is away from the bottom, falls back to bottom-relative distance when
the anchor is unavailable, and follows the true bottom for a new or bottom-locked thread. A separate
immediate resize observer covers layout outside the virtualizer's measurement root, including
conversation padding and late media layout, but writes only while bottom following is active so it
cannot drag a reader away from an earlier turn.

ChatGPT Desktop 26.901.51231 (build 8109) defines `ThreadScope` in the renderer bundle with
`key: clientThreadId` and `retain: { max: 20 }`; its route scope uses the same retention bound.
Cypheria mirrors that lifecycle with a separate renderer-owned retained chat-scope cache. Each scope
owns one external AI SDK `Chat` and one IPC transport, and a newly created chat adds its durable App
Server thread ID as an alias of its initial client key. At most 20 inactive terminal scopes remain in
the LRU. Mounted, submitted, and streaming scopes are pinned, so the cache may temporarily exceed 20
only when more than 20 chats are simultaneously active; it prunes back after they finish. This bounds
the usual memory cost by recent conversation state rather than total thread count.

Route navigation only detaches the React view from a retained scope; it does not stop the turn or
destroy the AI SDK stream. The stable transport reads the latest project, model, permission, resume,
and completion callbacks from the scope's mutable bindings. A successfully finished stream
synchronizes its complete UI message sequence into the existing thread-detail query entry, so
switching away and back cannot briefly rehydrate an older cached turn list. Pending reverse requests
are independently retained by Electron main and exposed through a typed list operation, allowing a
remounted renderer view to reconstruct approval or question cards instead of relying on a one-shot
event. Provider reasoning chunks must likewise be balanced: an empty reasoning item emits neither
start nor end, and duplicate completion cannot emit a second end.

Every transport stream removes both its App Server event subscription and its `AbortSignal`
listener on completion, failure, abort, or direct stream cancellation. Cancellation also clears the
active request before interrupting App Server, so completed scopes do not accumulate per-stream
listener closures. On macOS, closing the main window hides it rather than destroying the renderer;
activating the app shows the same window, so the chat scopes and scroll state survive. A real
application quit intentionally clears this session-only state.

Explicit Stop issues the interrupt IPC call, immediately projects any live turn and item lifecycle
to `interrupted`/`completed`, and synchronizes that optimistic result into the thread query cache
before refreshing durable App Server state. Electron main sends one `turn/interrupt` before
aborting the AI SDK stream, avoiding concurrent duplicate interrupts. The current view therefore
shows the same stopped state as a cold reload without requiring a route switch.

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
- Cold-open a generated-image thread and confirm both item cards and Markdown images in the final
  answer render, while an unrelated local path remains unavailable.
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
