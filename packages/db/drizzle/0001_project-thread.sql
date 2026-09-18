CREATE TABLE `project_items` (
	`project_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `thread_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_items_position_check" CHECK("project_items"."position" >= 0),
	CONSTRAINT "project_items_created_at_check" CHECK("project_items"."created_at" >= 0),
	CONSTRAINT "project_items_updated_at_check" CHECK("project_items"."updated_at" >= "project_items"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_items_thread_id_unique` ON `project_items` (`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_items_project_position_unique` ON `project_items` (`project_id`,`position`);--> statement-breakpoint
CREATE INDEX `project_items_project_id_idx` ON `project_items` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`roots` text NOT NULL,
	`position` integer NOT NULL,
	`recency_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "projects_id_uuidv7_check" CHECK(length("projects"."id") = 36 AND substr("projects"."id", 15, 1) = '7'),
	CONSTRAINT "projects_name_check" CHECK(length(trim("projects"."name")) > 0),
	CONSTRAINT "projects_position_check" CHECK("projects"."position" >= 0),
	CONSTRAINT "projects_recency_at_check" CHECK("projects"."recency_at" IS NULL OR "projects"."recency_at" >= 0),
	CONSTRAINT "projects_created_at_check" CHECK("projects"."created_at" >= 0),
	CONSTRAINT "projects_updated_at_check" CHECK("projects"."updated_at" >= "projects"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_position_unique` ON `projects` (`position`);--> statement-breakpoint
CREATE INDEX `projects_recency_at_idx` ON `projects` (`recency_at`);--> statement-breakpoint
CREATE TABLE `section_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` text NOT NULL,
	`item_type` text NOT NULL,
	`thread_id` text,
	`project_id` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "section_items_target_check" CHECK((
        ("section_items"."item_type" = 'thread' AND "section_items"."thread_id" IS NOT NULL AND "section_items"."project_id" IS NULL)
        OR
        ("section_items"."item_type" = 'project' AND "section_items"."project_id" IS NOT NULL AND "section_items"."thread_id" IS NULL)
      )),
	CONSTRAINT "section_items_position_check" CHECK("section_items"."position" >= 0),
	CONSTRAINT "section_items_created_at_check" CHECK("section_items"."created_at" >= 0),
	CONSTRAINT "section_items_updated_at_check" CHECK("section_items"."updated_at" >= "section_items"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `section_items_thread_id_unique` ON `section_items` (`thread_id`) WHERE "section_items"."thread_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `section_items_project_id_unique` ON `section_items` (`project_id`) WHERE "section_items"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `section_items_section_position_unique` ON `section_items` (`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `section_items_section_id_idx` ON `section_items` (`section_id`);--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "sections_id_uuidv7_check" CHECK(length("sections"."id") = 36 AND substr("sections"."id", 15, 1) = '7'),
	CONSTRAINT "sections_name_check" CHECK(length(trim("sections"."name")) > 0),
	CONSTRAINT "sections_position_check" CHECK("sections"."position" >= 0),
	CONSTRAINT "sections_created_at_check" CHECK("sections"."created_at" >= 0),
	CONSTRAINT "sections_updated_at_check" CHECK("sections"."updated_at" >= "sections"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sections_position_unique` ON `sections` (`position`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`agent_session_id` text,
	`forked_from_id` text,
	`title` text,
	`cwd` text,
	`position` integer NOT NULL,
	`recency_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_registry`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`forked_from_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "threads_id_uuidv7_check" CHECK(length("threads"."id") = 36 AND substr("threads"."id", 15, 1) = '7'),
	CONSTRAINT "threads_position_check" CHECK("threads"."position" >= 0),
	CONSTRAINT "threads_recency_at_check" CHECK("threads"."recency_at" IS NULL OR "threads"."recency_at" >= 0),
	CONSTRAINT "threads_created_at_check" CHECK("threads"."created_at" >= 0),
	CONSTRAINT "threads_updated_at_check" CHECK("threads"."updated_at" >= "threads"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threads_position_unique` ON `threads` (`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `threads_agent_session_unique` ON `threads` (`agent_id`,`agent_session_id`) WHERE "threads"."agent_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_agent_id_idx` ON `threads` (`agent_id`);--> statement-breakpoint
CREATE INDEX `threads_forked_from_id_idx` ON `threads` (`forked_from_id`);--> statement-breakpoint
CREATE INDEX `threads_recency_at_idx` ON `threads` (`recency_at`);
