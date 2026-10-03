CREATE TABLE `code_review_prs` (
	`list` text NOT NULL,
	`account_key` text NOT NULL,
	`url_key` text NOT NULL,
	`item` text NOT NULL,
	`saved_at` integer NOT NULL,
	PRIMARY KEY(`list`, `account_key`, `url_key`),
	CONSTRAINT "code_review_prs_list_check" CHECK("code_review_prs"."list" IN ('pinned', 'recent')),
	CONSTRAINT "code_review_prs_account_check" CHECK(length("code_review_prs"."account_key") > 0),
	CONSTRAINT "code_review_prs_url_check" CHECK(length("code_review_prs"."url_key") > 0)
);--> statement-breakpoint
CREATE INDEX `code_review_prs_order_idx` ON `code_review_prs` (`list`,`account_key`,`saved_at`);--> statement-breakpoint
CREATE TABLE `workspace_threads` (
	`workspace_key` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_threads_key_check" CHECK(length("workspace_threads"."workspace_key") > 0),
	CONSTRAINT "workspace_threads_updated_at_check" CHECK("workspace_threads"."updated_at" >= 0)
);--> statement-breakpoint
CREATE INDEX `workspace_threads_thread_idx` ON `workspace_threads` (`thread_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_code_review_runs` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_key` text NOT NULL,
	`pr_key` text NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`review` text,
	`chat_target` text,
	`thread_id` text,
	`turn_id` text,
	`started_at` integer,
	`diff_lines` text,
	`prepared` text,
	`unanchored_findings` text,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "code_review_runs_status_check" CHECK("__new_code_review_runs"."status" IN ('preparing', 'queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "code_review_runs_target_check" CHECK("__new_code_review_runs"."review" IS NOT NULL OR "__new_code_review_runs"."chat_target" IS NOT NULL),
	CONSTRAINT "code_review_runs_chat_turn_check" CHECK(("__new_code_review_runs"."thread_id" IS NULL) = ("__new_code_review_runs"."turn_id" IS NULL)),
	CONSTRAINT "code_review_runs_lease_check" CHECK("__new_code_review_runs"."lease_until" >= 0)
);--> statement-breakpoint
INSERT INTO `__new_code_review_runs`("sequence", "account_key", "pr_key", "run_id", "status", "lease_until", "review", "chat_target", "thread_id", "turn_id", "started_at", "diff_lines", "prepared", "unanchored_findings") SELECT "sequence", "account_key", "pull_request_key", "run_id", "status", "lease_until", "review", "chat_target", "thread_id", "turn_id", "started_at", "diff_lines", "prepared", "unanchored_findings" FROM `code_reviews`;--> statement-breakpoint
DROP TABLE `code_reviews`;--> statement-breakpoint
ALTER TABLE `__new_code_review_runs` RENAME TO `code_review_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `code_review_runs_run_unique` ON `code_review_runs` (`account_key`,`pr_key`,`run_id`);--> statement-breakpoint
CREATE INDEX `code_review_runs_pr_idx` ON `code_review_runs` (`account_key`,`pr_key`,`sequence`);--> statement-breakpoint
CREATE INDEX `code_review_runs_status_lease_idx` ON `code_review_runs` (`status`,`lease_until`);--> statement-breakpoint
CREATE UNIQUE INDEX `code_review_runs_chat_turn_unique` ON `code_review_runs` (`thread_id`,`turn_id`) WHERE "code_review_runs"."thread_id" IS NOT NULL;
