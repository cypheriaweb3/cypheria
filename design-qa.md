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
