PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_wallets` (
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
        ("__new_wallets"."kind" IN ('hd', 'private-key', 'private-key-group') AND "__new_wallets"."vault_id" IS NOT NULL)
        OR
        ("__new_wallets"."kind" IN ('watch', 'watch-group') AND "__new_wallets"."vault_id" IS NULL)
      )),
	CONSTRAINT "wallets_status_check" CHECK("__new_wallets"."status" IN ('initializing', 'ready', 'error', 'deleting'))
);
--> statement-breakpoint
INSERT INTO `__new_wallets`("id", "name", "kind", "fingerprint", "vault_id", "metadata", "position", "status", "created_at", "updated_at") SELECT "id", "name", "kind", "fingerprint", "vault_id", "metadata", "position", "status", "created_at", "updated_at" FROM `wallets`;--> statement-breakpoint
DROP TABLE `wallets`;--> statement-breakpoint
ALTER TABLE `__new_wallets` RENAME TO `wallets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_fingerprint_unique` ON `wallets` (`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_name_unique` ON `wallets` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_vault_id_unique` ON `wallets` (`vault_id`);--> statement-breakpoint
CREATE INDEX `wallets_position_idx` ON `wallets` (`position`);--> statement-breakpoint
CREATE INDEX `wallets_status_idx` ON `wallets` (`status`);