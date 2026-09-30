CREATE TABLE `plugin_marketplaces` (
	`name` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`ref_name` text,
	`sparse_paths` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
