CREATE TABLE `dapp_network_contexts` (
	`origin` text NOT NULL,
	`protocol` text NOT NULL,
	`network_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`origin`) REFERENCES `dapp_origins`(`origin`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dapp_network_contexts_protocol_check" CHECK("dapp_network_contexts"."protocol" IN ('eip155', 'solana'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dapp_network_contexts_origin_protocol_unique` ON `dapp_network_contexts` (`origin`,`protocol`);--> statement-breakpoint
CREATE INDEX `dapp_network_contexts_network_idx` ON `dapp_network_contexts` (`network_id`);--> statement-breakpoint
CREATE TABLE `network_rpc_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`label` text NOT NULL,
	`transport` text NOT NULL,
	`connection_kind` text NOT NULL,
	`url` text,
	`display_url` text,
	`credential_ref` text,
	`source` text NOT NULL,
	`enabled` integer NOT NULL,
	`deprecated` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "network_rpc_endpoints_position_check" CHECK("network_rpc_endpoints"."position" >= 0),
	CONSTRAINT "network_rpc_endpoints_revision_check" CHECK("network_rpc_endpoints"."revision" > 0),
	CONSTRAINT "network_rpc_endpoints_enabled_check" CHECK("network_rpc_endpoints"."enabled" IN (0, 1)),
	CONSTRAINT "network_rpc_endpoints_deprecated_check" CHECK("network_rpc_endpoints"."deprecated" IN (0, 1)),
	CONSTRAINT "network_rpc_endpoints_transport_check" CHECK("network_rpc_endpoints"."transport" IN ('http', 'websocket')),
	CONSTRAINT "network_rpc_endpoints_source_check" CHECK("network_rpc_endpoints"."source" IN ('builtin', 'custom')),
	CONSTRAINT "network_rpc_endpoints_connection_check" CHECK((
        ("network_rpc_endpoints"."connection_kind" = 'public' AND "network_rpc_endpoints"."url" IS NOT NULL AND "network_rpc_endpoints"."display_url" IS NULL AND "network_rpc_endpoints"."credential_ref" IS NULL)
        OR
        ("network_rpc_endpoints"."connection_kind" = 'protected' AND "network_rpc_endpoints"."url" IS NULL AND "network_rpc_endpoints"."display_url" IS NOT NULL AND "network_rpc_endpoints"."credential_ref" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `network_rpc_endpoints_network_position_unique` ON `network_rpc_endpoints` (`network_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `network_rpc_endpoints_credential_ref_unique` ON `network_rpc_endpoints` (`credential_ref`);--> statement-breakpoint
CREATE INDEX `network_rpc_endpoints_network_idx` ON `network_rpc_endpoints` (`network_id`);--> statement-breakpoint
CREATE INDEX `network_rpc_endpoints_enabled_idx` ON `network_rpc_endpoints` (`enabled`);--> statement-breakpoint
CREATE TABLE `networks` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`reference` text NOT NULL,
	`name` text NOT NULL,
	`native_currency` text NOT NULL,
	`explorers` text NOT NULL,
	`testnet` integer NOT NULL,
	`source` text NOT NULL,
	`catalog_key` text,
	`enabled` integer NOT NULL,
	`deprecated` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "networks_position_check" CHECK("networks"."position" >= 0),
	CONSTRAINT "networks_revision_check" CHECK("networks"."revision" > 0),
	CONSTRAINT "networks_enabled_check" CHECK("networks"."enabled" IN (0, 1)),
	CONSTRAINT "networks_deprecated_check" CHECK("networks"."deprecated" IN (0, 1)),
	CONSTRAINT "networks_namespace_check" CHECK("networks"."namespace" IN ('eip155', 'solana')),
	CONSTRAINT "networks_source_check" CHECK("networks"."source" IN ('builtin', 'custom')),
	CONSTRAINT "networks_catalog_ownership_check" CHECK((("networks"."source" = 'builtin' AND "networks"."catalog_key" IS NOT NULL) OR ("networks"."source" = 'custom' AND "networks"."catalog_key" IS NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `networks_chain_unique` ON `networks` (`namespace`,`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `networks_catalog_key_unique` ON `networks` (`catalog_key`);--> statement-breakpoint
CREATE INDEX `networks_position_idx` ON `networks` (`position`);--> statement-breakpoint
CREATE INDEX `networks_enabled_idx` ON `networks` (`enabled`);