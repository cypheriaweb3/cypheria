ALTER TABLE `projects` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `projects_deleted_at_idx` ON `projects` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `sections` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `sections_deleted_at_idx` ON `sections` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `threads` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `threads_deleted_at_idx` ON `threads` (`deleted_at`);
