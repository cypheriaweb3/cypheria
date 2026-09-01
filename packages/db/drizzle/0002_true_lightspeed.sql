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
CREATE INDEX `wallets_status_idx` ON `wallets` (`status`);