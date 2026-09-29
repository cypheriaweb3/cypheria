PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`archived_at` integer,
	`deleted_at` integer,
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`agent_session_id` text,
	`config` text NOT NULL,
	`forked_from_id` text,
	`title` text,
	`roots` text NOT NULL,
	`position` integer NOT NULL,
	`recency_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_registry`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`forked_from_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "threads_id_uuidv7_check" CHECK(length("__new_threads"."id") = 36 AND substr("__new_threads"."id", 15, 1) = '7'),
	CONSTRAINT "threads_position_check" CHECK("__new_threads"."position" >= 0),
	CONSTRAINT "threads_roots_json_check" CHECK(json_valid("__new_threads"."roots") AND json_type("__new_threads"."roots") = 'array' AND json_array_length("__new_threads"."roots") > 0),
	CONSTRAINT "threads_archived_at_check" CHECK("__new_threads"."archived_at" IS NULL OR "__new_threads"."archived_at" >= 0),
	CONSTRAINT "threads_recency_at_check" CHECK("__new_threads"."recency_at" IS NULL OR "__new_threads"."recency_at" >= 0),
	CONSTRAINT "threads_created_at_check" CHECK("__new_threads"."created_at" >= 0),
	CONSTRAINT "threads_updated_at_check" CHECK("__new_threads"."updated_at" >= "__new_threads"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_threads`("archived_at", "deleted_at", "id", "agent_id", "agent_session_id", "config", "forked_from_id", "title", "roots", "position", "recency_at", "created_at", "updated_at")
SELECT
	"archived_at",
	"deleted_at",
	"id",
	"agent_id",
	"agent_session_id",
	"config",
	"forked_from_id",
	"title",
	COALESCE(
		(
			SELECT `projects`.`roots`
			FROM `project_items`
			INNER JOIN `projects` ON `projects`.`id` = `project_items`.`project_id`
			WHERE `project_items`.`thread_id` = `threads`.`id`
		),
		CASE
			WHEN "cwd" IS NOT NULL AND length(trim("cwd")) > 0 THEN json_array("cwd")
			ELSE json_array('/tmp/cypheria-migrated-' || "id")
		END
	),
	"position",
	"recency_at",
	"created_at",
	"updated_at"
FROM `threads`;--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `threads_position_unique` ON `threads` (`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `threads_agent_session_unique` ON `threads` (`agent_id`,`agent_session_id`) WHERE "threads"."agent_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_agent_id_idx` ON `threads` (`agent_id`);--> statement-breakpoint
CREATE INDEX `threads_archived_at_idx` ON `threads` (`archived_at`);--> statement-breakpoint
CREATE INDEX `threads_deleted_at_idx` ON `threads` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `threads_forked_from_id_idx` ON `threads` (`forked_from_id`);--> statement-breakpoint
CREATE INDEX `threads_recency_at_idx` ON `threads` (`recency_at`);--> statement-breakpoint
CREATE INDEX `threads_roots_idx` ON `threads` (`roots`);--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`roots` text NOT NULL,
	`position` integer NOT NULL,
	`recency_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "projects_id_uuidv7_check" CHECK(length("__new_projects"."id") = 36 AND substr("__new_projects"."id", 15, 1) = '7'),
	CONSTRAINT "projects_name_check" CHECK(length(trim("__new_projects"."name")) > 0),
	CONSTRAINT "projects_roots_json_check" CHECK(json_valid("__new_projects"."roots") AND json_type("__new_projects"."roots") = 'array' AND json_array_length("__new_projects"."roots") > 0),
	CONSTRAINT "projects_position_check" CHECK("__new_projects"."position" >= 0),
	CONSTRAINT "projects_recency_at_check" CHECK("__new_projects"."recency_at" IS NULL OR "__new_projects"."recency_at" >= 0),
	CONSTRAINT "projects_created_at_check" CHECK("__new_projects"."created_at" >= 0),
	CONSTRAINT "projects_updated_at_check" CHECK("__new_projects"."updated_at" >= "__new_projects"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "name", "roots", "position", "recency_at", "deleted_at", "created_at", "updated_at") SELECT "id", "name", "roots", "position", "recency_at", "deleted_at", "created_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_position_unique` ON `projects` (`position`);--> statement-breakpoint
CREATE INDEX `projects_recency_at_idx` ON `projects` (`recency_at`);--> statement-breakpoint
CREATE INDEX `projects_deleted_at_idx` ON `projects` (`deleted_at`);
