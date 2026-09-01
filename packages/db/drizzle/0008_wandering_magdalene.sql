PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_automation_tasks` (
	`audit_correlation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`definition` text DEFAULT '{"handler":"noop"}' NOT NULL,
	`description` text,
	`id` text PRIMARY KEY NOT NULL,
	`run_history` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`trigger` text NOT NULL,
	`updated_at` text NOT NULL,
	`wallet_policy_scope` text NOT NULL,
	`workspace` text NOT NULL,
	CONSTRAINT "automation_tasks_status_check" CHECK("__new_automation_tasks"."status" IN ('archived', 'draft', 'enabled', 'paused')),
	CONSTRAINT "automation_tasks_revision_check" CHECK("__new_automation_tasks"."revision" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_automation_tasks`("audit_correlation_id", "created_at", "definition", "description", "id", "run_history", "revision", "status", "title", "trigger", "updated_at", "wallet_policy_scope", "workspace") SELECT "audit_correlation_id", "created_at", '{"handler":"noop"}', "description", "id", "run_history", 1, "status", "title", "trigger", "updated_at", "wallet_policy_scope", "workspace" FROM `automation_tasks`;--> statement-breakpoint
DROP TABLE `automation_tasks`;--> statement-breakpoint
ALTER TABLE `__new_automation_tasks` RENAME TO `automation_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `automation_tasks_audit_correlation_id_idx` ON `automation_tasks` (`audit_correlation_id`);--> statement-breakpoint
CREATE INDEX `automation_tasks_status_idx` ON `automation_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `automation_tasks_workspace_idx` ON `automation_tasks` (`workspace`);--> statement-breakpoint
CREATE TABLE `__new_automation_runs` (
	`audit_correlation_id` text NOT NULL,
	`completed_at` text,
	`error` text,
	`id` text PRIMARY KEY NOT NULL,
	`logs` text NOT NULL,
	`queued_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`started_at` text,
	`status` text NOT NULL,
	`task_id` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `automation_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_runs_status_check" CHECK("__new_automation_runs"."status" IN ('cancelled', 'failed', 'queued', 'running', 'succeeded')),
	CONSTRAINT "automation_runs_revision_check" CHECK("__new_automation_runs"."revision" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_automation_runs`("audit_correlation_id", "completed_at", "error", "id", "logs", "queued_at", "revision", "started_at", "status", "task_id") SELECT "audit_correlation_id", "completed_at", "error", "id", "logs", COALESCE("started_at", "completed_at", '1970-01-01T00:00:00.000Z'), 1, "started_at", "status", "task_id" FROM `automation_runs`;--> statement-breakpoint
DROP TABLE `automation_runs`;--> statement-breakpoint
ALTER TABLE `__new_automation_runs` RENAME TO `automation_runs`;--> statement-breakpoint
CREATE INDEX `automation_runs_audit_correlation_id_idx` ON `automation_runs` (`audit_correlation_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_status_idx` ON `automation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `automation_runs_task_id_idx` ON `automation_runs` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_active_task_unique` ON `automation_runs` (`task_id`) WHERE "automation_runs"."status" IN ('queued', 'running');
