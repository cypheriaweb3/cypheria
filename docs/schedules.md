# Schedules

> Status: Current implementation

Schedules are durable Server-owned jobs. Desktop and CLI manage them only through `client.schedules`; no client timer is authoritative.

## Cadence

Three cadence forms are supported:

- `once` at an ISO timestamp;
- `interval` with a minimum one-second period;
- `cron` with an expression and optional IANA timezone.

The Server validates cadence, calculates `nextRunAt`, and records revision, status, last run, and timestamps. Schedule status is `active`, `paused`, or `completed`. A one-time schedule completes after its terminal run.

## Targets

A schedule targets one of:

- `new-thread`: choose an Agent, content, and optional working directory and title;
- `thread`: continue an existing Cypheria Thread with new content;
- `web3`: invoke an allowed Web3 runtime method with validated parameters.

Thread content uses the same typed input blocks and Agent capability checks as an interactive turn. A created Thread ID is recorded on the run.

## Persistence and leasing

Definitions and run records are stored in SQLite. A run records its schedule, scheduled time, actual start and finish, target kind, status, optional created Thread, result, and error. Run status is `running`, `succeeded`, `failed`, or `interrupted`.

Execution uses a persistent lease so only one worker claims a due occurrence. The lease and revision checks prevent a second process or recovery pass from executing the same occurrence concurrently. Manual runs use the same run-record path.

## Startup recovery

On startup the Server:

1. marks abandoned running records as interrupted;
2. loads active definitions;
3. recalculates valid next occurrences;
4. claims and executes due recoverable work once;
5. publishes schedule and run updates.

Recovery never treats an unknown external side effect as safe to repeat. Missed cadence handling and next-run calculation are deterministic and covered by schedule tests.

## Web3 non-replay rule

An interrupted Web3 signing or sending run is never automatically replayed. Its run remains `interrupted` or `failed` with audit context. A user must explicitly start a new run, which creates a new signing intent and passes policy again.

The same rule applies when the Server cannot prove whether a provider accepted a transaction. Idempotency is not inferred from a transaction method name.

## Operations

The protocol supports create, get, list, update, pause, resume, delete, manual run, and run-history list. Change notifications keep clients synchronized. Mutations return authoritative schedule or run values.

Schedule targets remain within current product boundaries. A complex workflow engine and multi-Agent orchestration are not implemented.

## Safety and observability

- Validate cadence, timezone, target, Agent capability, Thread state, and Web3 method before execution.
- Re-evaluate policy at execution time; creating a schedule is not signing approval.
- Record schedule and run correlation in audit events.
- Redact secrets from target parameters, results, errors, and logs.
- Bound execution and release leases after terminal state.
- Never depend on a connected Desktop client for progress or recovery.
