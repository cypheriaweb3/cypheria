CREATE TABLE `active_wallet_context` (
	`chain_account_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`updated_at` text NOT NULL,
	`wallet_account_id` text NOT NULL,
	`wallet_id` text NOT NULL,
	FOREIGN KEY (`chain_account_id`) REFERENCES `chain_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_account_id`) REFERENCES `wallet_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "active_wallet_context_mode_check" CHECK("active_wallet_context"."mode" IN ('conditional-auto-signing', 'human-approval', 'read-only'))
);
--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`expires_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`intent_id` text NOT NULL,
	`requested_at` text NOT NULL,
	`resolved_at` text,
	`reviewer` text,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`intent_id`) REFERENCES `signing_intents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "approval_requests_revision_check" CHECK("approval_requests"."revision" > 0),
	CONSTRAINT "approval_requests_status_check" CHECK("approval_requests"."status" IN ('approved', 'expired', 'pending', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_requests_intent_id_unique` ON `approval_requests` (`intent_id`);--> statement-breakpoint
CREATE INDEX `approval_requests_status_idx` ON `approval_requests` (`status`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`actor` text NOT NULL,
	`correlation_id` text,
	`created_at` text NOT NULL,
	`event_type` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`payload_hash` text,
	`payload_summary` text,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_correlation_id_idx` ON `audit_logs` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_event_type_idx` ON `audit_logs` (`event_type`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`audit_correlation_id` text NOT NULL,
	`completed_at` text,
	`error` text,
	`id` text PRIMARY KEY NOT NULL,
	`logs` text NOT NULL,
	`queued_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`started_at` text,
	`status` text NOT NULL,
	`task_id` text NOT NULL,
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
	`audit_correlation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`definition` text DEFAULT '{"handler":"noop"}' NOT NULL,
	`description` text,
	`id` text PRIMARY KEY NOT NULL,
	`run_history` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`trigger` text NOT NULL,
	`updated_at` text NOT NULL,
	`wallet_policy_scope` text NOT NULL,
	`workspace` text NOT NULL,
	CONSTRAINT "automation_tasks_status_check" CHECK("automation_tasks"."status" IN ('archived', 'draft', 'enabled', 'paused')),
	CONSTRAINT "automation_tasks_revision_check" CHECK("automation_tasks"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `automation_tasks_audit_correlation_id_idx` ON `automation_tasks` (`audit_correlation_id`);--> statement-breakpoint
CREATE INDEX `automation_tasks_status_idx` ON `automation_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `automation_tasks_workspace_idx` ON `automation_tasks` (`workspace`);--> statement-breakpoint
CREATE TABLE `chain_accounts` (
	`address` text NOT NULL,
	`chain_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`derivation_path` text,
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`public_key` text,
	`updated_at` text NOT NULL,
	`wallet_account_id` text NOT NULL,
	FOREIGN KEY (`wallet_account_id`) REFERENCES `wallet_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chain_accounts_chain_id_check" CHECK("chain_accounts"."chain_id" > 0),
	CONSTRAINT "chain_accounts_namespace_check" CHECK("chain_accounts"."namespace" = 'eip155')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chain_accounts_account_namespace_chain_unique` ON `chain_accounts` (`wallet_account_id`,`namespace`,`chain_id`);--> statement-breakpoint
CREATE INDEX `chain_accounts_address_idx` ON `chain_accounts` (`namespace`,`chain_id`,`address`);--> statement-breakpoint
CREATE INDEX `chain_accounts_wallet_account_id_idx` ON `chain_accounts` (`wallet_account_id`);--> statement-breakpoint
CREATE TABLE `dapp_origins` (
	`created_at` text NOT NULL,
	`last_used_at` text,
	`origin` text PRIMARY KEY NOT NULL,
	`partition` text NOT NULL,
	`session_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dapp_origins_session_key_unique` ON `dapp_origins` (`session_key`);--> statement-breakpoint
CREATE TABLE `dapp_permissions` (
	`account_addresses` text NOT NULL,
	`chain_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	`id` text PRIMARY KEY NOT NULL,
	`methods` text NOT NULL,
	`origin` text NOT NULL,
	`session_key` text NOT NULL,
	`updated_at` text NOT NULL,
	`wallet_id` text NOT NULL,
	FOREIGN KEY (`origin`) REFERENCES `dapp_origins`(`origin`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dapp_permissions_origin_wallet_chain_unique` ON `dapp_permissions` (`origin`,`wallet_id`,`chain_id`);--> statement-breakpoint
CREATE INDEX `dapp_permissions_origin_idx` ON `dapp_permissions` (`origin`);--> statement-breakpoint
CREATE INDEX `dapp_permissions_wallet_id_idx` ON `dapp_permissions` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `runtime_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signing_intent_claims` (
	`claimed_at` text NOT NULL,
	`intent_id` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signing_intents` (
	`approval_id` text,
	`created_at` text NOT NULL,
	`decision` text NOT NULL,
	`decision_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`matched_policy_id` text,
	`mode` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`wallet_id` text NOT NULL,
	CONSTRAINT "signing_intents_revision_check" CHECK("signing_intents"."revision" > 0),
	CONSTRAINT "signing_intents_source_check" CHECK("signing_intents"."source" IN ('agent', 'automation', 'dapp')),
	CONSTRAINT "signing_intents_status_check" CHECK("signing_intents"."status" IN ('approved', 'expired', 'pending-approval', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `signing_intents_status_idx` ON `signing_intents` (`status`);--> statement-breakpoint
CREATE INDEX `signing_intents_wallet_id_idx` ON `signing_intents` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `signing_policies` (
	`chain_ids` text NOT NULL,
	`contract_allowlist` text,
	`created_at` text NOT NULL,
	`effect` text NOT NULL,
	`enabled` integer NOT NULL,
	`expires_at` text,
	`id` text PRIMARY KEY NOT NULL,
	`max_native_value` text,
	`methods` text NOT NULL,
	`origins` text NOT NULL,
	`require_human_approval` integer NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`wallet_id` text NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "signing_policies_effect_check" CHECK("signing_policies"."effect" IN ('allow', 'deny', 'require-human-approval')),
	CONSTRAINT "signing_policies_revision_check" CHECK("signing_policies"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `signing_policies_wallet_id_idx` ON `signing_policies` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `signing_policies_enabled_idx` ON `signing_policies` (`enabled`);--> statement-breakpoint
CREATE TABLE `wallet_accounts` (
	`created_at` text NOT NULL,
	`fingerprint` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`account_index` integer NOT NULL,
	`name` text NOT NULL,
	`updated_at` text NOT NULL,
	`wallet_id` text NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wallet_accounts_index_check" CHECK("wallet_accounts"."account_index" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_accounts_wallet_index_unique` ON `wallet_accounts` (`wallet_id`,`account_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_accounts_wallet_name_unique` ON `wallet_accounts` (`wallet_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_accounts_wallet_fingerprint_unique` ON `wallet_accounts` (`wallet_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `wallet_accounts_wallet_id_idx` ON `wallet_accounts` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `wallet_hd_schemes` (
	`curve` text NOT NULL,
	`derive_position` integer NOT NULL,
	`namespace` text NOT NULL,
	`path_template` text NOT NULL,
	`probe_path` text NOT NULL,
	`wallet_id` text NOT NULL,
	PRIMARY KEY(`wallet_id`, `namespace`),
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wallet_hd_schemes_curve_check" CHECK("wallet_hd_schemes"."curve" = 'secp256k1'),
	CONSTRAINT "wallet_hd_schemes_derive_position_check" CHECK("wallet_hd_schemes"."derive_position" = 4),
	CONSTRAINT "wallet_hd_schemes_namespace_check" CHECK("wallet_hd_schemes"."namespace" = 'eip155')
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`created_at` text NOT NULL,
	`fingerprint` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`metadata` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`vault_id` text,
	CONSTRAINT "wallets_kind_provider_check" CHECK((
        ("wallets"."kind" IN ('hd', 'private-key', 'private-key-group') AND "wallets"."provider" = 'local-vault' AND "wallets"."vault_id" IS NOT NULL)
        OR
        ("wallets"."kind" IN ('watch', 'watch-group') AND "wallets"."provider" = 'read-only' AND "wallets"."vault_id" IS NULL)
      )),
	CONSTRAINT "wallets_status_check" CHECK("wallets"."status" IN ('initializing', 'ready', 'error', 'deleting'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_fingerprint_unique` ON `wallets` (`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_name_unique` ON `wallets` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_vault_id_unique` ON `wallets` (`vault_id`);--> statement-breakpoint
CREATE INDEX `wallets_status_idx` ON `wallets` (`status`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`last_opened_at` text,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspaces_path_idx` ON `workspaces` (`path`);