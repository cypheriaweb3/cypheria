CREATE TABLE `automation_runs` (
	`audit_correlation_id` text NOT NULL,
	`completed_at` text,
	`error` text,
	`id` text PRIMARY KEY NOT NULL,
	`logs` text NOT NULL,
	`started_at` text,
	`status` text NOT NULL,
	`task_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automation_runs_audit_correlation_id_idx` ON `automation_runs` (`audit_correlation_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_status_idx` ON `automation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `automation_runs_task_id_idx` ON `automation_runs` (`task_id`);--> statement-breakpoint
CREATE TABLE `automation_tasks` (
	`audit_correlation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`description` text,
	`id` text PRIMARY KEY NOT NULL,
	`run_history` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`trigger` text NOT NULL,
	`updated_at` text NOT NULL,
	`wallet_policy_scope` text NOT NULL,
	`workspace` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automation_tasks_audit_correlation_id_idx` ON `automation_tasks` (`audit_correlation_id`);--> statement-breakpoint
CREATE INDEX `automation_tasks_status_idx` ON `automation_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `automation_tasks_workspace_idx` ON `automation_tasks` (`workspace`);