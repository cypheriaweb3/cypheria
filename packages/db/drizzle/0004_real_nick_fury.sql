CREATE TABLE `signing_intent_claims` (
	`claimed_at` text NOT NULL,
	`intent_id` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL
);
