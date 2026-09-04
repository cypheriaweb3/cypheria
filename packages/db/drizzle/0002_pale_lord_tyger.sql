ALTER TABLE `wallets` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `wallets_position_idx` ON `wallets` (`position`);