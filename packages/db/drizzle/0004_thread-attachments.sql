CREATE TABLE `thread_attachments` (
	`thread_id` text NOT NULL,
	`attachment_type` text NOT NULL,
	`identity_key` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `attachment_type`, `identity_key`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_attachments_type_check" CHECK("thread_attachments"."attachment_type" IN ('pull_request', 'worktree')),
	CONSTRAINT "thread_attachments_identity_key_check" CHECK(length("thread_attachments"."identity_key") > 0),
	CONSTRAINT "thread_attachments_created_at_check" CHECK("thread_attachments"."created_at" >= 0),
	CONSTRAINT "thread_attachments_updated_at_check" CHECK("thread_attachments"."updated_at" >= "thread_attachments"."created_at")
);
--> statement-breakpoint
CREATE INDEX `thread_attachments_identity_idx` ON `thread_attachments` (`attachment_type`,`identity_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_attachments_worktree_identity_unique` ON `thread_attachments` (`attachment_type`,`identity_key`) WHERE "thread_attachments"."attachment_type" = 'worktree';