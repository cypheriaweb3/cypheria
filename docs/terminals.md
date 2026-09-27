---
title: Terminals
---

# Terminals

Cypheria terminals are privileged, ephemeral Server resources. The Server owns PTY processes and authoritative headless terminal state; clients render authorized streams through `@cypheria/client`. Terminal entities are not persisted and do not survive a Server restart.

## Thread terminals

A Thread may own multiple terminals, and each terminal belongs to exactly one Thread. Creation accepts a Thread ID, display name, and initial size. The Server resolves the current Thread working directory and rejects missing, deleted, or archived Threads. A later Thread working-directory change does not move existing PTYs; new terminals use the new directory.

The terminal directory is shared Server state. Clients subscribed to the same Thread receive the same terminal list, names, dynamic titles, sizes, exits, and process output. Creating a terminal causes every subscribed Desktop to add its tab, while tab order, selected tab, panel placement, and panel visibility remain device-local. Closing a tab terminates the shared PTY for every client. Hiding a panel, navigating away, disconnecting, or unsubscribing does not terminate it.

Stopping, resuming, or rewinding a Thread leaves its terminals running. Forking a Thread starts with no terminals. Archiving or deleting a Thread terminates all of its terminals. Existing terminals retain their original working directory when the Thread moves.

## Authentication terminals

Interactive Claude and ACP authentication commands use the same worker, PTY, headless state, binary stream, resize ownership, and restore implementation. An authentication terminal has a private scope containing its flow ID and owning logical client session. It is absent from Thread terminal lists and directory notifications, and another client ID cannot discover or subscribe to it even when authenticated as the same principal.

The owning logical client may reconnect within the normal session grace period and restore the current terminal screen. Authentication completion, failure, cancellation, logical-session expiry, or Server shutdown terminates the PTY and releases the authentication reservation. Public rename, capture, and ordinary close operations do not accept authentication terminals; cancellation remains a harness operation.

## Streaming and recovery

Directory and stream authorization use ordinary CBOR requests. Terminal input, output, resize, and ANSI restore use the binary codec documented in [Client/server protocol](protocol.md). Each physical connection assigns stream-local slots, so reconnecting creates new subscriptions and slots. The SDK resubscribes and requests a fresh snapshot but never buffers or replays user input.

The worker runs `node-pty` and `@xterm/headless`, keeps 1000 scrollback lines, coalesces short output bursts, and returns ANSI snapshots. A revision barrier holds live output while a snapshot is produced and then sends only newer output. Slow physical connections switch to a fresh snapshot after both the output and transport-backpressure thresholds are crossed. Resize uses a claim flag; the most recently claiming subscribed source owns subsequent passive resize updates until it disconnects or another source claims ownership.

## Resource limits

The Server permits up to 32 terminals per Thread and 256 terminals in total. A physical connection has 256 stream slots. Terminal dimensions are limited to 2–1000 columns and 1–1000 rows. Output and restore data is split into frames no larger than 64 KiB. Terminal environments include `TERM=xterm-256color`, `COLORTERM=truecolor`, and `TERM_PROGRAM=cypheria`.
