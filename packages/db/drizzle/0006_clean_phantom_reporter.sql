PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_network_rpc_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`label` text NOT NULL,
	`transport` text NOT NULL,
	`connection_kind` text NOT NULL,
	`url` text,
	`display_url` text,
	`credential_ref` text,
	`source` text NOT NULL,
	`local_development` integer DEFAULT false NOT NULL,
	`enabled` integer NOT NULL,
	`deprecated` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "network_rpc_endpoints_position_check" CHECK("__new_network_rpc_endpoints"."position" >= 0),
	CONSTRAINT "network_rpc_endpoints_revision_check" CHECK("__new_network_rpc_endpoints"."revision" > 0),
	CONSTRAINT "network_rpc_endpoints_enabled_check" CHECK("__new_network_rpc_endpoints"."enabled" IN (0, 1)),
	CONSTRAINT "network_rpc_endpoints_local_development_check" CHECK("__new_network_rpc_endpoints"."local_development" IN (0, 1)),
	CONSTRAINT "network_rpc_endpoints_deprecated_check" CHECK("__new_network_rpc_endpoints"."deprecated" IN (0, 1)),
	CONSTRAINT "network_rpc_endpoints_transport_check" CHECK("__new_network_rpc_endpoints"."transport" IN ('http', 'websocket')),
	CONSTRAINT "network_rpc_endpoints_source_check" CHECK("__new_network_rpc_endpoints"."source" IN ('builtin', 'custom')),
	CONSTRAINT "network_rpc_endpoints_connection_check" CHECK((
        ("__new_network_rpc_endpoints"."connection_kind" = 'public' AND "__new_network_rpc_endpoints"."url" IS NOT NULL AND "__new_network_rpc_endpoints"."display_url" IS NULL AND "__new_network_rpc_endpoints"."credential_ref" IS NULL)
        OR
        ("__new_network_rpc_endpoints"."connection_kind" = 'protected' AND "__new_network_rpc_endpoints"."url" IS NULL AND "__new_network_rpc_endpoints"."display_url" IS NOT NULL AND "__new_network_rpc_endpoints"."credential_ref" IS NOT NULL)
      ))
);
--> statement-breakpoint
INSERT INTO `__new_network_rpc_endpoints`("id", "network_id", "label", "transport", "connection_kind", "url", "display_url", "credential_ref", "source", "local_development", "enabled", "deprecated", "position", "revision", "created_at", "updated_at") SELECT "id", "network_id", "label", "transport", "connection_kind", "url", "display_url", "credential_ref", "source", false, "enabled", "deprecated", "position", "revision", "created_at", "updated_at" FROM `network_rpc_endpoints`;--> statement-breakpoint
DROP TABLE `network_rpc_endpoints`;--> statement-breakpoint
ALTER TABLE `__new_network_rpc_endpoints` RENAME TO `network_rpc_endpoints`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `network_rpc_endpoints_network_position_unique` ON `network_rpc_endpoints` (`network_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `network_rpc_endpoints_credential_ref_unique` ON `network_rpc_endpoints` (`credential_ref`);--> statement-breakpoint
CREATE INDEX `network_rpc_endpoints_network_idx` ON `network_rpc_endpoints` (`network_id`);--> statement-breakpoint
CREATE INDEX `network_rpc_endpoints_enabled_idx` ON `network_rpc_endpoints` (`enabled`);--> statement-breakpoint
ALTER TABLE `networks` ADD `verification` text DEFAULT '{"kind":"evm-chain-id"}' NOT NULL;--> statement-breakpoint
UPDATE `networks` SET `verification` = CASE `reference`
	WHEN 'mainnet' THEN '{"kind":"solana-genesis-hash","genesisHash":"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"}'
	WHEN 'devnet' THEN '{"kind":"solana-genesis-hash","genesisHash":"EtWTRABZaYq6iMfeYKouRu166VU2xqa1"}'
	ELSE '{"kind":"solana-genesis-hash","genesisHash":"11111111111111111111111111111111"}'
END WHERE `namespace` = 'solana';
