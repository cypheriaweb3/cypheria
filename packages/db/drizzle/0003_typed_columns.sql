PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_signing_intents` (
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
	CONSTRAINT "signing_intents_revision_check" CHECK("revision" > 0),
	CONSTRAINT "signing_intents_source_check" CHECK("source" IN ('agent', 'automation', 'dapp')),
	CONSTRAINT "signing_intents_mode_check" CHECK("mode" IN ('conditional-auto-signing', 'human-approval', 'read-only')),
	CONSTRAINT "signing_intents_decision_check" CHECK("decision" IN ('allow', 'deny', 'require-human-approval')),
	CONSTRAINT "signing_intents_status_check" CHECK("status" IN ('approved', 'expired', 'pending-approval', 'rejected'))
);
--> statement-breakpoint
INSERT INTO `__new_signing_intents`("id", "wallet_id", "approval_id", "matched_policy_id", "payload", "payload_hash", "source", "mode", "decision", "decision_id", "status", "revision", "created_at", "updated_at", "expires_at") SELECT "id", "wallet_id", "approval_id", "matched_policy_id", "payload", "payload_hash", "source", "mode", "decision", "decision_id", "status", "revision", "created_at", "updated_at", "expires_at" FROM `signing_intents`;--> statement-breakpoint
DROP TABLE `signing_intents`;--> statement-breakpoint
ALTER TABLE `__new_signing_intents` RENAME TO `signing_intents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `signing_intents_status_idx` ON `signing_intents` (`status`);--> statement-breakpoint
CREATE INDEX `signing_intents_wallet_id_idx` ON `signing_intents` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `__new_signing_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`chain_ids` text NOT NULL,
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
	CONSTRAINT "signing_policies_effect_check" CHECK("effect" IN ('allow', 'deny', 'require-human-approval')),
	CONSTRAINT "signing_policies_enabled_check" CHECK("enabled" IN (0, 1)),
	CONSTRAINT "signing_policies_require_human_approval_check" CHECK("require_human_approval" IN (0, 1)),
	CONSTRAINT "signing_policies_revision_check" CHECK("revision" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_signing_policies`("id", "wallet_id", "chain_ids", "methods", "origins", "contract_allowlist", "max_native_value", "effect", "require_human_approval", "enabled", "revision", "created_at", "updated_at", "expires_at") SELECT "id", "wallet_id", "chain_ids", "methods", "origins", "contract_allowlist", "max_native_value", "effect", "require_human_approval", "enabled", "revision", "created_at", "updated_at", "expires_at" FROM `signing_policies`;--> statement-breakpoint
DROP TABLE `signing_policies`;--> statement-breakpoint
ALTER TABLE `__new_signing_policies` RENAME TO `signing_policies`;--> statement-breakpoint
CREATE INDEX `signing_policies_wallet_id_idx` ON `signing_policies` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `signing_policies_enabled_idx` ON `signing_policies` (`enabled`);
