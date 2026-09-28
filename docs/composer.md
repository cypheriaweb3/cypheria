---
title: Composer Inputs and References
---

# Composer Inputs and References

## Ownership and data flow

The shared Tiptap editor is presentation state. Desktop keeps each draft on its device; the Server owns reference validation, uploaded bytes, Thread history, and Agent input mapping. A selected mention is an ordered `reference` input block, not Markdown parsed back into an identity. Ordinary typed `@`, `$`, or `/` text remains text. The Server resolves selected references immediately before start, steer, or queue submission, and stores the original structured input on the user Timeline item so a client can restore a branch composer. A failed validation does not claim the submission receipt.

Other clients can use the same `@cypheria/client` APIs without sharing Desktop's local draft database. Draft synchronization is not implied by the Thread API.

## Triggers and candidates

`@` searches workspace files, existing Threads, Thread-owned browser tabs, and (for Codex) installed enabled plugins and MCP resources. `$` searches enabled Codex skills and accessible enabled Apps. Candidate lookup uses `threads.composer.suggest`; it is scoped to an existing Thread or the proposed Agent and working directory for a new Thread. The Server rechecks the selected ID at submission, including file realpath containment within the workspace and browser-tab Thread ownership. Candidate labels are display text, not authority.

`/` is a Desktop-local command menu; it does not send an App Server skill token. Its currently executable actions are attaching a file, clearing the draft, opening a new chat, showing status, showing the goal, and requesting Codex compaction. Unselected slash text is sent literally. There is no generic arbitrary tool execution from a slash item, and no Agent selector is synthesized when the Agent does not advertise it.

## Submission mapping

The public input union contains text, existing image/audio/resource blocks, `reference`, and `uploaded-file`. The Server projects a verified workspace file to a path link, a Thread to a bounded `cypheria_read_thread` dynamic-tool instruction, a browser tab to its current tab identity, and an enabled skill, App, plugin, or MCP resource to an Agent-readable pointer. These are hints and resolvable identifiers, not snapshots of the referenced content. The model or its tools must read a path or resource in an authorized execution environment. Thread reading is bounded and explicitly labels content untrusted. References unsupported by the selected Agent fail before turn submission rather than silently degrading to a fake mention. The Server stores the original blocks, while the Agent receives the projected blocks.

## Uploaded files and drafts

Desktop attachments first live in its local `AttachmentStore`. On submission, owned bytes go through the Server upload API in bounded chunks with SHA-256 verification; `upload.start/chunk/status/complete/abort` supports offset recovery. The returned opaque file ID is sent as `uploaded-file`, never as a client-local path or base64 prompt. The Server binds that file to its Thread and maps its managed local resource to the Agent input. A scoped `input-file.get` supports another client reading a Thread's uploaded bytes. Uploads and file IDs are limited to 32 MiB, and unbound uploads are cleaned after 24 hours. This is distinct from Thread attachment artifacts such as pull requests and worktrees.

The draft stores text/structured input and ordered attachment metadata, not binary base64. A failed send leaves the draft available. Uploading does not itself create a Timeline message. The UI must show missing local bytes as unavailable and avoid submitting them. After a successful submission, a client may reconstruct visible history from the Canonical Timeline, including structured input identities; the local editor document is not shared across devices.

## Boundaries and limitations

The Server does not infer semantic mentions from Markdown-shaped text. `@agent` has an editor node type for future Agent-specific integration but is not offered by the Server and is rejected at submission. MCP resource pointers are not automatically inlined as bytes; the selected Agent still needs an available reader/tool. File candidate search is bounded, ignores common generated directories, and is not a full repository index. Binary upload bytes and client drafts are separate from the Canonical Timeline; only stable IDs and validated input blocks enter history.
