CREATE TABLE `code_reviews` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_key` text NOT NULL,
	`pull_request_key` text NOT NULL,
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
	CONSTRAINT "code_reviews_status_check" CHECK("code_reviews"."status" IN ('preparing', 'queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "code_reviews_target_check" CHECK("code_reviews"."review" IS NOT NULL OR "code_reviews"."chat_target" IS NOT NULL),
	CONSTRAINT "code_reviews_chat_turn_check" CHECK(("code_reviews"."thread_id" IS NULL) = ("code_reviews"."turn_id" IS NULL)),
	CONSTRAINT "code_reviews_lease_check" CHECK("code_reviews"."lease_until" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_reviews_run_unique` ON `code_reviews` (`account_key`,`pull_request_key`,`run_id`);--> statement-breakpoint
CREATE INDEX `code_reviews_pull_request_idx` ON `code_reviews` (`account_key`,`pull_request_key`,`sequence`);--> statement-breakpoint
CREATE INDEX `code_reviews_status_lease_idx` ON `code_reviews` (`status`,`lease_until`);--> statement-breakpoint
CREATE UNIQUE INDEX `code_reviews_chat_turn_unique` ON `code_reviews` (`thread_id`,`turn_id`) WHERE "code_reviews"."thread_id" IS NOT NULL;