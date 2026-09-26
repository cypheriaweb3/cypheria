PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_thread_lifecycle_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_session_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`input` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_registry`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "thread_lifecycle_operations_kind_check" CHECK("__new_thread_lifecycle_operations"."kind" IN ('create', 'delete', 'fork', 'rewind')),
	CONSTRAINT "thread_lifecycle_operations_status_check" CHECK("__new_thread_lifecycle_operations"."status" IN ('pending', 'harness-created', 'harness-deleted', 'provider-branched', 'binding-committed', 'timeline-replaced', 'failed')),
	CONSTRAINT "thread_lifecycle_operations_created_at_check" CHECK("__new_thread_lifecycle_operations"."created_at" >= 0),
	CONSTRAINT "thread_lifecycle_operations_updated_at_check" CHECK("__new_thread_lifecycle_operations"."updated_at" >= "__new_thread_lifecycle_operations"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_thread_lifecycle_operations`("id", "thread_id", "agent_id", "agent_session_id", "kind", "status", "input", "error", "created_at", "updated_at") SELECT "id", "thread_id", "agent_id", "agent_session_id", "kind", "status", "input", "error", "created_at", "updated_at" FROM `thread_lifecycle_operations`;--> statement-breakpoint
DROP TABLE `thread_lifecycle_operations`;--> statement-breakpoint
ALTER TABLE `__new_thread_lifecycle_operations` RENAME TO `thread_lifecycle_operations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `thread_lifecycle_operations_thread_id_idx` ON `thread_lifecycle_operations` (`thread_id`);--> statement-breakpoint
CREATE INDEX `thread_lifecycle_operations_status_idx` ON `thread_lifecycle_operations` (`status`);
