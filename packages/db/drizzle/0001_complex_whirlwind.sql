ALTER TABLE `agent_registry` ADD `created_at` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `agent_registry` ADD `removed_at` text;--> statement-breakpoint
UPDATE `agent_registry` SET `created_at` = `updated_at` WHERE `created_at` = '';--> statement-breakpoint
UPDATE `agent_registry`
SET `removed_at` = `updated_at`
WHERE `native` = 0 AND `installed` = 0;
