ALTER TABLE `signing_policies` RENAME COLUMN "chain_ids" TO "chain_keys";--> statement-breakpoint
UPDATE `signing_policies` SET `chain_keys` = (
	SELECT json_group_array(
		CASE WHEN typeof(value) IN ('integer', 'real')
			THEN 'eip155:' || CAST(value AS TEXT)
			ELSE value
		END
	) FROM json_each(`signing_policies`.`chain_keys`)
);--> statement-breakpoint
UPDATE `automation_tasks` SET `wallet_policy_scope` = json_remove(
	json_set(
		`wallet_policy_scope`,
		'$.chainKeys',
		json((
			SELECT json_group_array(
				CASE WHEN typeof(value) IN ('integer', 'real')
					THEN 'eip155:' || CAST(value AS TEXT)
					ELSE value
				END
			) FROM json_each(json_extract(`automation_tasks`.`wallet_policy_scope`, '$.chainIds'))
		))
	),
	'$.chainIds'
);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chain_accounts` (
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
	CONSTRAINT "chain_accounts_reference_check" CHECK(length("__new_chain_accounts"."reference") > 0),
	CONSTRAINT "chain_accounts_namespace_check" CHECK("__new_chain_accounts"."namespace" IN ('eip155', 'solana'))
);
--> statement-breakpoint
INSERT INTO `__new_chain_accounts`("id", "wallet_account_id", "namespace", "reference", "address", "public_key", "derivation_path", "created_at", "updated_at") SELECT "id", "wallet_account_id", "namespace", CAST("chain_id" AS TEXT), "address", "public_key", "derivation_path", "created_at", "updated_at" FROM `chain_accounts`;--> statement-breakpoint
DROP TABLE `chain_accounts`;--> statement-breakpoint
ALTER TABLE `__new_chain_accounts` RENAME TO `chain_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `chain_accounts_account_namespace_reference_unique` ON `chain_accounts` (`wallet_account_id`,`namespace`,`reference`);--> statement-breakpoint
CREATE INDEX `chain_accounts_address_idx` ON `chain_accounts` (`namespace`,`reference`,`address`);--> statement-breakpoint
CREATE INDEX `chain_accounts_wallet_account_id_idx` ON `chain_accounts` (`wallet_account_id`);--> statement-breakpoint
CREATE TABLE `__new_dapp_permissions` (
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
INSERT INTO `__new_dapp_permissions`("id", "origin", "session_key", "wallet_id", "chain_key", "account_addresses", "methods", "created_at", "updated_at", "expires_at") SELECT "id", "origin", "session_key", "wallet_id", 'eip155:' || CAST("chain_id" AS TEXT), "account_addresses", "methods", "created_at", "updated_at", "expires_at" FROM `dapp_permissions`;--> statement-breakpoint
DROP TABLE `dapp_permissions`;--> statement-breakpoint
ALTER TABLE `__new_dapp_permissions` RENAME TO `dapp_permissions`;--> statement-breakpoint
CREATE UNIQUE INDEX `dapp_permissions_origin_wallet_chain_unique` ON `dapp_permissions` (`origin`,`wallet_id`,`chain_key`);--> statement-breakpoint
CREATE INDEX `dapp_permissions_origin_idx` ON `dapp_permissions` (`origin`);--> statement-breakpoint
CREATE INDEX `dapp_permissions_wallet_id_idx` ON `dapp_permissions` (`wallet_id`);--> statement-breakpoint
DROP TABLE `active_wallet_context`;--> statement-breakpoint
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
