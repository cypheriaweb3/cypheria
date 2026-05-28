CREATE TABLE `audit_logs` (
	`actor` text NOT NULL,
	`correlation_id` text,
	`created_at` text NOT NULL,
	`event_type` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`payload_hash` text,
	`payload_summary` text,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_correlation_id_idx` ON `audit_logs` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_event_type_idx` ON `audit_logs` (`event_type`);--> statement-breakpoint
CREATE TABLE `runtime_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`last_opened_at` text,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspaces_path_idx` ON `workspaces` (`path`);
