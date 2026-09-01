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
CREATE INDEX `dapp_permissions_wallet_id_idx` ON `dapp_permissions` (`wallet_id`);