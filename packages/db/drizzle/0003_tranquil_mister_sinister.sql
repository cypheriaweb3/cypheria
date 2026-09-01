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
