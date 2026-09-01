CREATE TABLE `solana_dapp_permissions` (
	`bindings` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`session_key` text NOT NULL,
	`updated_at` text NOT NULL,
	`wallet_id` text NOT NULL,
	FOREIGN KEY (`origin`) REFERENCES `dapp_origins`(`origin`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solana_dapp_permissions_origin_wallet_unique` ON `solana_dapp_permissions` (`origin`,`wallet_id`);--> statement-breakpoint
CREATE INDEX `solana_dapp_permissions_origin_idx` ON `solana_dapp_permissions` (`origin`);--> statement-breakpoint
CREATE INDEX `solana_dapp_permissions_wallet_id_idx` ON `solana_dapp_permissions` (`wallet_id`);