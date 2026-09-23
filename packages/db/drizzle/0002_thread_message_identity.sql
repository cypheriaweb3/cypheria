CREATE TABLE `thread_message_requests` (
	`thread_id` text NOT NULL,
	`client_message_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`turn_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `client_message_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_message_requests_client_message_id_check" CHECK(length("thread_message_requests"."client_message_id") > 0),
	CONSTRAINT "thread_message_requests_fingerprint_check" CHECK(length("thread_message_requests"."fingerprint") > 0),
	CONSTRAINT "thread_message_requests_status_check" CHECK("thread_message_requests"."status" IN ('pending', 'completed')),
	CONSTRAINT "thread_message_requests_turn_id_check" CHECK(("thread_message_requests"."status" = 'pending' AND "thread_message_requests"."turn_id" IS NULL) OR ("thread_message_requests"."status" = 'completed' AND length("thread_message_requests"."turn_id") > 0)),
	CONSTRAINT "thread_message_requests_created_at_check" CHECK("thread_message_requests"."created_at" >= 0),
	CONSTRAINT "thread_message_requests_updated_at_check" CHECK("thread_message_requests"."updated_at" >= "thread_message_requests"."created_at")
);
--> statement-breakpoint
CREATE INDEX `thread_message_requests_status_idx` ON `thread_message_requests` (`status`);--> statement-breakpoint
ALTER TABLE `thread_timeline_rows` ADD `agent_message_id` text;--> statement-breakpoint
CREATE INDEX `thread_timeline_rows_agent_message_id_idx` ON `thread_timeline_rows` (`agent_message_id`);