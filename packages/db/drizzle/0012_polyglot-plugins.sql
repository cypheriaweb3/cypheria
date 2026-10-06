-- The plugin tables are created from scratch. Built-in marketplaces are recorded again when the
-- Server starts. A database that already holds these tables from an unreleased build starts over.
DROP TABLE IF EXISTS `plugin_agent_bindings`;--> statement-breakpoint
DROP TABLE IF EXISTS `installed_plugins`;--> statement-breakpoint
DROP TABLE IF EXISTS `plugin_marketplaces`;--> statement-breakpoint
CREATE TABLE `plugin_marketplaces` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`source` text NOT NULL,
	`ref_name` text,
	`sparse_paths` text,
	`owner_agent_id` text,
	`local_path` text NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `installed_plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`marketplace_id` text NOT NULL,
	`plugin_name` text NOT NULL,
	`display_name` text NOT NULL,
	`version` text,
	`description` text,
	`install_source_type` text NOT NULL,
	`install_source_url` text NOT NULL,
	`install_path` text,
	`detected_formats` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`marketplace_id`) REFERENCES `plugin_marketplaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plugin_agent_bindings` (
	`plugin_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`native_install_receipt` text,
	`installed_sha256` text,
	`status_message` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`plugin_id`, `agent_id`),
	FOREIGN KEY (`plugin_id`) REFERENCES `installed_plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
