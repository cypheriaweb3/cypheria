CREATE TABLE `approval_requests` (
	`expires_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`intent_id` text NOT NULL,
	`requested_at` text NOT NULL,
	`resolved_at` text,
	`reviewer` text,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`intent_id`) REFERENCES `signing_intents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "approval_requests_revision_check" CHECK("approval_requests"."revision" > 0),
	CONSTRAINT "approval_requests_status_check" CHECK("approval_requests"."status" IN ('approved', 'expired', 'pending', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_requests_intent_id_unique` ON `approval_requests` (`intent_id`);--> statement-breakpoint
CREATE INDEX `approval_requests_status_idx` ON `approval_requests` (`status`);--> statement-breakpoint
CREATE TABLE `signing_intents` (
	`approval_id` text,
	`created_at` text NOT NULL,
	`decision` text NOT NULL,
	`decision_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`matched_policy_id` text,
	`mode` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`wallet_id` text NOT NULL,
	CONSTRAINT "signing_intents_revision_check" CHECK("signing_intents"."revision" > 0),
	CONSTRAINT "signing_intents_source_check" CHECK("signing_intents"."source" IN ('agent', 'automation', 'dapp')),
	CONSTRAINT "signing_intents_status_check" CHECK("signing_intents"."status" IN ('approved', 'expired', 'pending-approval', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `signing_intents_status_idx` ON `signing_intents` (`status`);--> statement-breakpoint
CREATE INDEX `signing_intents_wallet_id_idx` ON `signing_intents` (`wallet_id`);