CREATE TABLE `active_wallet_context` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`wallet_account_id` text NOT NULL,
	`chain_account_id` text NOT NULL,
	`network_id` text NOT NULL,
	`mode` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_account_id`) REFERENCES `wallet_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chain_account_id`) REFERENCES `chain_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "active_wallet_context_mode_check" CHECK("active_wallet_context"."mode" IN ('conditional-auto-signing', 'human-approval', 'read-only'))
);
--> statement-breakpoint
CREATE TABLE `agent_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`version` text,
	`description` text,
	`repository` text,
	`website` text,
	`icon` text,
	`native` integer NOT NULL,
	`installed` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`intent_id` text NOT NULL,
	`status` text NOT NULL,
	`reviewer` text,
	`revision` integer NOT NULL,
	`requested_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`intent_id`) REFERENCES `signing_intents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "approval_requests_revision_check" CHECK("approval_requests"."revision" > 0),
	CONSTRAINT "approval_requests_status_check" CHECK("approval_requests"."status" IN ('approved', 'expired', 'pending', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_requests_intent_id_unique` ON `approval_requests` (`intent_id`);--> statement-breakpoint
CREATE INDEX `approval_requests_status_idx` ON `approval_requests` (`status`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`correlation_id` text,
	`actor` text NOT NULL,
	`event_type` text NOT NULL,
	`source` text NOT NULL,
	`payload_hash` text,
	`payload_summary` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_correlation_id_idx` ON `audit_logs` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_event_type_idx` ON `audit_logs` (`event_type`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`logs` text NOT NULL,
	`error` text,
	`status` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`audit_correlation_id` text NOT NULL,
	`queued_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `automation_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_runs_status_check" CHECK("automation_runs"."status" IN ('cancelled', 'failed', 'queued', 'running', 'succeeded')),
	CONSTRAINT "automation_runs_revision_check" CHECK("automation_runs"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `automation_runs_audit_correlation_id_idx` ON `automation_runs` (`audit_correlation_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_status_idx` ON `automation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `automation_runs_task_id_idx` ON `automation_runs` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_active_task_unique` ON `automation_runs` (`task_id`) WHERE "automation_runs"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE TABLE `automation_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`trigger` text NOT NULL,
	`definition` text DEFAULT '{"handler":"noop"}' NOT NULL,
	`wallet_policy_scope` text NOT NULL,
	`run_history` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`audit_correlation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "automation_tasks_status_check" CHECK("automation_tasks"."status" IN ('archived', 'draft', 'enabled', 'paused')),
	CONSTRAINT "automation_tasks_revision_check" CHECK("automation_tasks"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `automation_tasks_audit_correlation_id_idx` ON `automation_tasks` (`audit_correlation_id`);--> statement-breakpoint
CREATE INDEX `automation_tasks_status_idx` ON `automation_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `automation_tasks_workspace_idx` ON `automation_tasks` (`workspace`);--> statement-breakpoint
CREATE TABLE `chain_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_account_id` text NOT NULL,
	`namespace` text NOT NULL,
	`reference` text NOT NULL,
	`address` text NOT NULL,
	`public_key` text,
	`derivation_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`wallet_account_id`) REFERENCES `wallet_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chain_accounts_reference_check" CHECK(length("chain_accounts"."reference") > 0),
	CONSTRAINT "chain_accounts_namespace_check" CHECK("chain_accounts"."namespace" IN ('eip155', 'solana'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chain_accounts_account_namespace_reference_unique` ON `chain_accounts` (`wallet_account_id`,`namespace`,`reference`);--> statement-breakpoint
CREATE INDEX `chain_accounts_address_idx` ON `chain_accounts` (`namespace`,`reference`,`address`);--> statement-breakpoint
CREATE INDEX `chain_accounts_wallet_account_id_idx` ON `chain_accounts` (`wallet_account_id`);--> statement-breakpoint
CREATE TABLE `dapp_network_contexts` (
	`origin` text NOT NULL,
	`protocol` text NOT NULL,
	`network_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`origin`) REFERENCES `dapp_origins`(`origin`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dapp_network_contexts_protocol_check" CHECK("dapp_network_contexts"."protocol" IN ('eip155', 'solana'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dapp_network_contexts_origin_protocol_unique` ON `dapp_network_contexts` (`origin`,`protocol`);--> statement-breakpoint
CREATE INDEX `dapp_network_contexts_network_idx` ON `dapp_network_contexts` (`network_id`);--> statement-breakpoint
CREATE TABLE `dapp_origins` (
	`origin` text PRIMARY KEY NOT NULL,
	`session_key` text NOT NULL,
	`partition` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dapp_origins_session_key_unique` ON `dapp_origins` (`session_key`);--> statement-breakpoint
CREATE TABLE `dapp_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`session_key` text NOT NULL,
	`wallet_id` text NOT NULL,
	`chain_key` text NOT NULL,
	`account_addresses` text NOT NULL,
	`methods` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`origin`) REFERENCES `dapp_origins`(`origin`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dapp_permissions_origin_wallet_chain_unique` ON `dapp_permissions` (`origin`,`wallet_id`,`chain_key`);--> statement-breakpoint
CREATE INDEX `dapp_permissions_origin_idx` ON `dapp_permissions` (`origin`);--> statement-breakpoint
CREATE INDEX `dapp_permissions_wallet_id_idx` ON `dapp_permissions` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `network_rpc_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`label` text NOT NULL,
	`transport` text NOT NULL,
	`connection_kind` text NOT NULL,
	`url` text,
	`display_url` text,
	`credential_ref` text,
	`source` text NOT NULL,
	`local_development` integer DEFAULT false NOT NULL,
	`enabled` integer NOT NULL,
	`deprecated` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "network_rpc_endpoints_position_check" CHECK("network_rpc_endpoints"."position" >= 0),
	CONSTRAINT "network_rpc_endpoints_revision_check" CHECK("network_rpc_endpoints"."revision" > 0),
	CONSTRAINT "network_rpc_endpoints_enabled_check" CHECK("network_rpc_endpoints"."enabled" IN (0, 1)),
	CONSTRAINT "network_rpc_endpoints_local_development_check" CHECK("network_rpc_endpoints"."local_development" IN (0, 1)),
	CONSTRAINT "network_rpc_endpoints_deprecated_check" CHECK("network_rpc_endpoints"."deprecated" IN (0, 1)),
	CONSTRAINT "network_rpc_endpoints_transport_check" CHECK("network_rpc_endpoints"."transport" IN ('http', 'websocket')),
	CONSTRAINT "network_rpc_endpoints_source_check" CHECK("network_rpc_endpoints"."source" IN ('builtin', 'custom')),
	CONSTRAINT "network_rpc_endpoints_connection_check" CHECK((
        ("network_rpc_endpoints"."connection_kind" = 'public' AND "network_rpc_endpoints"."url" IS NOT NULL AND "network_rpc_endpoints"."display_url" IS NULL AND "network_rpc_endpoints"."credential_ref" IS NULL)
        OR
        ("network_rpc_endpoints"."connection_kind" = 'protected' AND "network_rpc_endpoints"."url" IS NULL AND "network_rpc_endpoints"."display_url" IS NOT NULL AND "network_rpc_endpoints"."credential_ref" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `network_rpc_endpoints_network_position_unique` ON `network_rpc_endpoints` (`network_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `network_rpc_endpoints_credential_ref_unique` ON `network_rpc_endpoints` (`credential_ref`);--> statement-breakpoint
CREATE INDEX `network_rpc_endpoints_network_idx` ON `network_rpc_endpoints` (`network_id`);--> statement-breakpoint
CREATE INDEX `network_rpc_endpoints_enabled_idx` ON `network_rpc_endpoints` (`enabled`);--> statement-breakpoint
CREATE TABLE `networks` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`reference` text NOT NULL,
	`name` text NOT NULL,
	`native_currency` text NOT NULL,
	`explorers` text NOT NULL,
	`verification` text NOT NULL,
	`testnet` integer NOT NULL,
	`source` text NOT NULL,
	`catalog_key` text,
	`enabled` integer NOT NULL,
	`deprecated` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "networks_position_check" CHECK("networks"."position" >= 0),
	CONSTRAINT "networks_revision_check" CHECK("networks"."revision" > 0),
	CONSTRAINT "networks_enabled_check" CHECK("networks"."enabled" IN (0, 1)),
	CONSTRAINT "networks_deprecated_check" CHECK("networks"."deprecated" IN (0, 1)),
	CONSTRAINT "networks_namespace_check" CHECK("networks"."namespace" IN ('eip155', 'solana')),
	CONSTRAINT "networks_source_check" CHECK("networks"."source" IN ('builtin', 'custom')),
	CONSTRAINT "networks_catalog_ownership_check" CHECK((("networks"."source" = 'builtin' AND "networks"."catalog_key" IS NOT NULL) OR ("networks"."source" = 'custom' AND "networks"."catalog_key" IS NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `networks_chain_unique` ON `networks` (`namespace`,`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `networks_catalog_key_unique` ON `networks` (`catalog_key`);--> statement-breakpoint
CREATE INDEX `networks_position_idx` ON `networks` (`position`);--> statement-breakpoint
CREATE INDEX `networks_enabled_idx` ON `networks` (`enabled`);--> statement-breakpoint
CREATE TABLE `project_items` (
	`project_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `thread_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_items_position_check" CHECK("project_items"."position" >= 0),
	CONSTRAINT "project_items_created_at_check" CHECK("project_items"."created_at" >= 0),
	CONSTRAINT "project_items_updated_at_check" CHECK("project_items"."updated_at" >= "project_items"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_items_thread_id_unique` ON `project_items` (`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_items_project_position_unique` ON `project_items` (`project_id`,`position`);--> statement-breakpoint
CREATE INDEX `project_items_project_id_idx` ON `project_items` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`roots` text NOT NULL,
	`position` integer NOT NULL,
	`recency_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "projects_id_uuidv7_check" CHECK(length("projects"."id") = 36 AND substr("projects"."id", 15, 1) = '7'),
	CONSTRAINT "projects_name_check" CHECK(length(trim("projects"."name")) > 0),
	CONSTRAINT "projects_position_check" CHECK("projects"."position" >= 0),
	CONSTRAINT "projects_recency_at_check" CHECK("projects"."recency_at" IS NULL OR "projects"."recency_at" >= 0),
	CONSTRAINT "projects_created_at_check" CHECK("projects"."created_at" >= 0),
	CONSTRAINT "projects_updated_at_check" CHECK("projects"."updated_at" >= "projects"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_position_unique` ON `projects` (`position`);--> statement-breakpoint
CREATE INDEX `projects_recency_at_idx` ON `projects` (`recency_at`);--> statement-breakpoint
CREATE TABLE `runtime_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_runs` (
	`created_thread_id` text,
	`error` text,
	`finished_at` integer,
	`id` text PRIMARY KEY NOT NULL,
	`result` text,
	`schedule_id` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`started_at` integer NOT NULL,
	`status` text NOT NULL,
	`target_type` text NOT NULL,
	FOREIGN KEY (`created_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "schedule_runs_status_check" CHECK("schedule_runs"."status" IN ('running', 'succeeded', 'failed', 'interrupted')),
	CONSTRAINT "schedule_runs_target_type_check" CHECK("schedule_runs"."target_type" IN ('new-thread', 'thread', 'web3')),
	CONSTRAINT "schedule_runs_scheduled_for_check" CHECK("schedule_runs"."scheduled_for" >= 0),
	CONSTRAINT "schedule_runs_started_at_check" CHECK("schedule_runs"."started_at" >= 0),
	CONSTRAINT "schedule_runs_finished_at_check" CHECK("schedule_runs"."finished_at" IS NULL OR "schedule_runs"."finished_at" >= "schedule_runs"."started_at")
);
--> statement-breakpoint
CREATE INDEX `schedule_runs_schedule_started_idx` ON `schedule_runs` (`schedule_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `schedule_runs_status_idx` ON `schedule_runs` (`status`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`cadence` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`last_run_at` integer,
	`lock_expires_at` integer,
	`locked_by` text,
	`name` text,
	`next_run_at` integer,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`target` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "schedules_revision_check" CHECK("schedules"."revision" >= 0),
	CONSTRAINT "schedules_status_check" CHECK("schedules"."status" IN ('active', 'paused', 'completed')),
	CONSTRAINT "schedules_created_at_check" CHECK("schedules"."created_at" >= 0),
	CONSTRAINT "schedules_updated_at_check" CHECK("schedules"."updated_at" >= "schedules"."created_at"),
	CONSTRAINT "schedules_lock_check" CHECK(("schedules"."locked_by" IS NULL AND "schedules"."lock_expires_at" IS NULL) OR ("schedules"."locked_by" IS NOT NULL AND "schedules"."lock_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `schedules_due_idx` ON `schedules` (`status`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `schedules_lock_expires_at_idx` ON `schedules` (`lock_expires_at`);--> statement-breakpoint
CREATE TABLE `section_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` text NOT NULL,
	`item_type` text NOT NULL,
	`thread_id` text,
	`project_id` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "section_items_target_check" CHECK((
        ("section_items"."item_type" = 'thread' AND "section_items"."thread_id" IS NOT NULL AND "section_items"."project_id" IS NULL)
        OR
        ("section_items"."item_type" = 'project' AND "section_items"."project_id" IS NOT NULL AND "section_items"."thread_id" IS NULL)
      )),
	CONSTRAINT "section_items_position_check" CHECK("section_items"."position" >= 0),
	CONSTRAINT "section_items_created_at_check" CHECK("section_items"."created_at" >= 0),
	CONSTRAINT "section_items_updated_at_check" CHECK("section_items"."updated_at" >= "section_items"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `section_items_thread_id_unique` ON `section_items` (`thread_id`) WHERE "section_items"."thread_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `section_items_project_id_unique` ON `section_items` (`project_id`) WHERE "section_items"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `section_items_section_position_unique` ON `section_items` (`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `section_items_section_id_idx` ON `section_items` (`section_id`);--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "sections_id_uuidv7_check" CHECK(length("sections"."id") = 36 AND substr("sections"."id", 15, 1) = '7'),
	CONSTRAINT "sections_name_check" CHECK(length(trim("sections"."name")) > 0),
	CONSTRAINT "sections_position_check" CHECK("sections"."position" >= 0),
	CONSTRAINT "sections_created_at_check" CHECK("sections"."created_at" >= 0),
	CONSTRAINT "sections_updated_at_check" CHECK("sections"."updated_at" >= "sections"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sections_position_unique` ON `sections` (`position`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signing_intent_claims` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL,
	`claimed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signing_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`approval_id` text,
	`matched_policy_id` text,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`source` text NOT NULL,
	`mode` text NOT NULL,
	`decision` text NOT NULL,
	`decision_id` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "signing_intents_revision_check" CHECK("signing_intents"."revision" > 0),
	CONSTRAINT "signing_intents_source_check" CHECK("signing_intents"."source" IN ('agent', 'automation', 'dapp')),
	CONSTRAINT "signing_intents_mode_check" CHECK("signing_intents"."mode" IN ('conditional-auto-signing', 'human-approval', 'read-only')),
	CONSTRAINT "signing_intents_decision_check" CHECK("signing_intents"."decision" IN ('allow', 'deny', 'require-human-approval')),
	CONSTRAINT "signing_intents_status_check" CHECK("signing_intents"."status" IN ('approved', 'expired', 'pending-approval', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `signing_intents_status_idx` ON `signing_intents` (`status`);--> statement-breakpoint
CREATE INDEX `signing_intents_wallet_id_idx` ON `signing_intents` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `signing_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`chain_keys` text NOT NULL,
	`methods` text NOT NULL,
	`origins` text NOT NULL,
	`contract_allowlist` text,
	`max_native_value` text,
	`effect` text NOT NULL,
	`require_human_approval` integer NOT NULL,
	`enabled` integer NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "signing_policies_effect_check" CHECK("signing_policies"."effect" IN ('allow', 'deny', 'require-human-approval')),
	CONSTRAINT "signing_policies_enabled_check" CHECK("signing_policies"."enabled" IN (0, 1)),
	CONSTRAINT "signing_policies_require_human_approval_check" CHECK("signing_policies"."require_human_approval" IN (0, 1)),
	CONSTRAINT "signing_policies_revision_check" CHECK("signing_policies"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `signing_policies_wallet_id_idx` ON `signing_policies` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `signing_policies_enabled_idx` ON `signing_policies` (`enabled`);--> statement-breakpoint
CREATE TABLE `solana_dapp_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`session_key` text NOT NULL,
	`wallet_id` text NOT NULL,
	`bindings` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`origin`) REFERENCES `dapp_origins`(`origin`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solana_dapp_permissions_origin_wallet_unique` ON `solana_dapp_permissions` (`origin`,`wallet_id`);--> statement-breakpoint
CREATE INDEX `solana_dapp_permissions_origin_idx` ON `solana_dapp_permissions` (`origin`);--> statement-breakpoint
CREATE INDEX `solana_dapp_permissions_wallet_id_idx` ON `solana_dapp_permissions` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `thread_lifecycle_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_session_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`input` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_registry`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "thread_lifecycle_operations_kind_check" CHECK("thread_lifecycle_operations"."kind" IN ('create', 'delete')),
	CONSTRAINT "thread_lifecycle_operations_status_check" CHECK("thread_lifecycle_operations"."status" IN ('pending', 'provider-created', 'provider-deleted', 'failed')),
	CONSTRAINT "thread_lifecycle_operations_created_at_check" CHECK("thread_lifecycle_operations"."created_at" >= 0),
	CONSTRAINT "thread_lifecycle_operations_updated_at_check" CHECK("thread_lifecycle_operations"."updated_at" >= "thread_lifecycle_operations"."created_at")
);
--> statement-breakpoint
CREATE INDEX `thread_lifecycle_operations_thread_id_idx` ON `thread_lifecycle_operations` (`thread_id`);--> statement-breakpoint
CREATE INDEX `thread_lifecycle_operations_status_idx` ON `thread_lifecycle_operations` (`status`);--> statement-breakpoint
CREATE TABLE `thread_timeline_epochs` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`epoch` text NOT NULL,
	`next_seq` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_timeline_epochs_epoch_check" CHECK(length("thread_timeline_epochs"."epoch") > 0),
	CONSTRAINT "thread_timeline_epochs_next_seq_check" CHECK("thread_timeline_epochs"."next_seq" >= 1),
	CONSTRAINT "thread_timeline_epochs_updated_at_check" CHECK("thread_timeline_epochs"."updated_at" >= 0)
);
--> statement-breakpoint
CREATE TABLE `thread_timeline_rows` (
	`thread_id` text NOT NULL,
	`epoch` text NOT NULL,
	`seq` integer NOT NULL,
	`turn_id` text,
	`provider_item_id` text,
	`timestamp` text NOT NULL,
	`item` text NOT NULL,
	PRIMARY KEY(`thread_id`, `epoch`, `seq`),
	FOREIGN KEY (`thread_id`) REFERENCES `thread_timeline_epochs`(`thread_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_timeline_rows_epoch_check" CHECK(length("thread_timeline_rows"."epoch") > 0),
	CONSTRAINT "thread_timeline_rows_seq_check" CHECK("thread_timeline_rows"."seq" >= 1),
	CONSTRAINT "thread_timeline_rows_timestamp_check" CHECK(length("thread_timeline_rows"."timestamp") > 0)
);
--> statement-breakpoint
CREATE INDEX `thread_timeline_rows_thread_epoch_seq_idx` ON `thread_timeline_rows` (`thread_id`,`epoch`,`seq`);--> statement-breakpoint
CREATE INDEX `thread_timeline_rows_turn_id_idx` ON `thread_timeline_rows` (`turn_id`);--> statement-breakpoint
CREATE TABLE `threads` (
	`archived_at` integer,
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`agent_session_id` text,
	`forked_from_id` text,
	`title` text,
	`cwd` text,
	`position` integer NOT NULL,
	`recency_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_registry`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`forked_from_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "threads_id_uuidv7_check" CHECK(length("threads"."id") = 36 AND substr("threads"."id", 15, 1) = '7'),
	CONSTRAINT "threads_position_check" CHECK("threads"."position" >= 0),
	CONSTRAINT "threads_archived_at_check" CHECK("threads"."archived_at" IS NULL OR "threads"."archived_at" >= 0),
	CONSTRAINT "threads_recency_at_check" CHECK("threads"."recency_at" IS NULL OR "threads"."recency_at" >= 0),
	CONSTRAINT "threads_created_at_check" CHECK("threads"."created_at" >= 0),
	CONSTRAINT "threads_updated_at_check" CHECK("threads"."updated_at" >= "threads"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threads_position_unique` ON `threads` (`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `threads_agent_session_unique` ON `threads` (`agent_id`,`agent_session_id`) WHERE "threads"."agent_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_agent_id_idx` ON `threads` (`agent_id`);--> statement-breakpoint
CREATE INDEX `threads_archived_at_idx` ON `threads` (`archived_at`);--> statement-breakpoint
CREATE INDEX `threads_forked_from_id_idx` ON `threads` (`forked_from_id`);--> statement-breakpoint
CREATE INDEX `threads_recency_at_idx` ON `threads` (`recency_at`);--> statement-breakpoint
CREATE TABLE `wallet_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`account_index` integer NOT NULL,
	`name` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wallet_accounts_index_check" CHECK("wallet_accounts"."account_index" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_accounts_wallet_index_unique` ON `wallet_accounts` (`wallet_id`,`account_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_accounts_wallet_name_unique` ON `wallet_accounts` (`wallet_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_accounts_wallet_fingerprint_unique` ON `wallet_accounts` (`wallet_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `wallet_accounts_wallet_id_idx` ON `wallet_accounts` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `wallet_hd_schemes` (
	`wallet_id` text NOT NULL,
	`namespace` text NOT NULL,
	`curve` text NOT NULL,
	`path_template` text NOT NULL,
	`probe_path` text NOT NULL,
	`derive_position` integer NOT NULL,
	PRIMARY KEY(`wallet_id`, `namespace`),
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wallet_hd_schemes_curve_check" CHECK("wallet_hd_schemes"."curve" = 'secp256k1'),
	CONSTRAINT "wallet_hd_schemes_derive_position_check" CHECK("wallet_hd_schemes"."derive_position" = 4),
	CONSTRAINT "wallet_hd_schemes_namespace_check" CHECK("wallet_hd_schemes"."namespace" = 'eip155')
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`vault_id` text,
	`metadata` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "wallets_kind_vault_check" CHECK((
        ("wallets"."kind" IN ('hd', 'private-key', 'private-key-group') AND "wallets"."vault_id" IS NOT NULL)
        OR
        ("wallets"."kind" IN ('watch', 'watch-group') AND "wallets"."vault_id" IS NULL)
      )),
	CONSTRAINT "wallets_status_check" CHECK("wallets"."status" IN ('initializing', 'ready', 'error', 'deleting'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_fingerprint_unique` ON `wallets` (`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_name_unique` ON `wallets` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_vault_id_unique` ON `wallets` (`vault_id`);--> statement-breakpoint
CREATE INDEX `wallets_position_idx` ON `wallets` (`position`);--> statement-breakpoint
CREATE INDEX `wallets_status_idx` ON `wallets` (`status`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_opened_at` text
);
--> statement-breakpoint
CREATE INDEX `workspaces_path_idx` ON `workspaces` (`path`);