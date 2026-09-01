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
CREATE INDEX `signing_policies_enabled_idx` ON `signing_policies` (`enabled`);