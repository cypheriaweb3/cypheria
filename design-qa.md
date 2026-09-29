# Design QA: Project editor

## Result

Passed.

## Evidence

- Reference: `/var/folders/py/l0kx36b51vj9l6c8tdgqc9380000gn/T/codex-clipboard-fef35867-2c9c-4f13-b726-eb78c1715712.png`
- Rendered implementation: `design-qa-assets/project-edit-implementation.png`
- Cropped implementation: `design-qa-assets/project-edit-implementation-crop.png`
- Side-by-side comparison: `design-qa-assets/project-edit-comparison.png`

## Visual checks

- Modal hierarchy, rounded container, close control, name field, source-folder list, footer actions, and destructive treatment match the reference composition.
- Folder rows preserve the reference density and dividers, with a distinct primary badge and secondary “Set as primary” actions.
- The implementation follows the active Cypheria theme for focus and primary-action colors instead of hard-coding the reference accent colors.
- Long folder names truncate without displacing row actions; the absolute path remains available as a title.

## Interaction checks

- Promoting a root moves it to the first position and updates the primary badge.
- Removing an additional root updates the list immediately.
- The final remaining root cannot be removed.
- The native directory picker adds a non-duplicate root.
- Save is disabled while the name is empty, the roots list is empty, or a mutation is pending.

# Design QA: New-chat project and worktree composer

## Source visual truth

- Path: `/var/folders/py/l0kx36b51vj9l6c8tdgqc9380000gn/T/codex-clipboard-9eeaf00f-c4cf-4ff3-b561-4f833cf8768c.png`
- Project picker path: `/var/folders/py/l0kx36b51vj9l6c8tdgqc9380000gn/T/codex-clipboard-c7bbaacc-74bd-4bbf-bacf-bed60295c7a8.png`
- Pixels: 1518 × 768
- State: new Codex chat composer with a selected project, local/worktree selector, starting branch, and expanded work-location explanation.

## Rendered implementation

- Screenshot: captured inline from the running Cypheria desktop app through the macOS accessibility surface.
- Viewport: 2560 × 1440 full-window capture.
- State verified: projectless, project-selected, Worktree-disabled, and Worktree-enabled new Codex composers.
- Branch menu verified against `git branch`: it contains the repository's existing local branches and excludes `origin/*` remote branches.
- Project picker verified with search results, an empty search result, current-project checkmark, New project dialog launch, and Don't work in a project action.

## Full-view comparison evidence

The source image was opened at its original dimensions and compared with the live implementation. The composer now uses the source's two-layer composition: a quiet secondary-surface context rail sits behind and slightly above the rounded white composer. The implementation intentionally replaces the source's Local/worktree mode menu with a compact Worktree checkbox while preserving the selected project and branch controls.

## Focused-region comparison evidence

The context rail was inspected in the projectless, project-selected, Worktree-disabled, and Worktree-enabled states. The clear-project control appears before the project name; the projectless state shows only Choose project; and the branch selector remains visible for either Worktree state. Project and branch menus open upward with a compact titled list, while the enabled Worktree state gains a restrained selected surface.

## Findings

- No blocking or polish findings remained after the live comparison.
- Control height, 14px labels, 16px icons, low-saturation surfaces, rounded menu geometry, and composer overlap now track the extracted ChatGPT implementation rather than appearing as an inset form row.
- The project picker now matches the dedicated reference: search is the first focused control, only hover/keyboard focus highlights a row, the current project uses a trailing checkmark, and the two static actions remain below a divider.
- The scrollable project result region uses TanStack Virtual with 40px rows and six-row overscan.

## Comparison history

- Pass 1: blocked before comparison because the macOS host was locked.
- Pass 2: compared the unlocked live app with the source, then verified projectless visibility, control order, Worktree toggling, and the local-only branch menu.
- Pass 3: replaced the inset header with an attached context rail, then rechecked the project menu, selected project state, local branch menu, and Worktree selected treatment in the running Desktop app.
- Pass 4: replaced the simple project Select with the searchable virtualized picker and verified the current-item, empty-result, and New project states in the running Desktop app.

## Implementation checklist

- [x] Capture the new-chat composer in a wide desktop layout.
- [x] Verify project selection and the clear-project button.
- [x] Toggle Worktree and verify the branch picker remains available.
- [x] Verify the branch menu contains only existing local branches.
- [x] Check typography, spacing/layout rhythm, colors/tokens, icon sharpness, and copy/content against the source.

## Follow-up polish

- None.

final result: passed
