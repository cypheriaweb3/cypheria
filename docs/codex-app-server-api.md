# Codex App Server API reference

This document analyzes the generated protocol currently committed under `packages/protocol/src/generated/codex`. It covers the complete API surface generated with experimental definitions enabled: 158 client requests, 11 server-initiated requests, 83 server notifications, and one client notification.

The Cypheria client protocol exposes this complete surface with mechanically generated dotted names under `agent.codex`. Slash separators become dots, camel-case segments become snake case, and the message direction is explicit: `.request`, `.response`, or `.notification`. Every dotted message has a method-specific Zod schema derived from the generated JSON Schema and statically paired with the matching generated Codex TypeScript type. These message contracts are exported from `@cypheria/protocol`, while raw generated Codex types are isolated behind `@cypheria/protocol/codex-types`.

The protocol uses JSON-RPC-style messages. Client requests contain `id`, `method`, and method-specific `params`; server requests use the same shape in the reverse direction; notifications have no `id`; successful responses contain `id` and `result`; errors contain `id` and `error`. A trailing `?` below marks an optional top-level field. The generated type named before each field list is the source of truth for nested structures and enum values.

## Client requests (158)

### Initialization

- `initialize` — Negotiate client capabilities and initialize the connection. Input: `InitializeParams`: `capabilities?`, `clientInfo`. Output: `InitializeResponse`: `codexHome`, `platformFamily`, `platformOs`, `userAgent`.

### Server

- `server/diagnostics` — Read process-local diagnostics without content data. Input: `ServerDiagnosticsParams`: `{}`. Output: `ServerDiagnosticsResponse`: `gauges`, `process`.

### Thread

- `thread/start` — Start thread. Input: `ThreadStartParams`: `allowProviderModelFallback?`, `approvalPolicy?`, `approvalsReviewer?`, `baseInstructions?`, `config?`, `cwd?`, `developerInstructions?`, `dynamicTools?`, `environments?`, `ephemeral?`, `experimentalRawEvents?`, `historyMode?`, `mockExperimentalField?`, `model?`, `modelProvider?`, `multiAgentMode?`, `permissions?`, `personality?`, `projectId?`, `runtimeWorkspaceRoots?`, `sandbox?`, `selectedCapabilityRoots?`, `serviceName?`, `serviceTier?`, `sessionStartSource?`, `threadSource?`. Output: `ThreadStartResponse`: `activePermissionProfile?`, `approvalPolicy`, `approvalsReviewer`, `cwd`, `instructionSources?`, `model`, `modelProvider`, `multiAgentMode?`, `reasoningEffort?`, `runtimeWorkspaceRoots?`, `sandbox`, `serviceTier?`, `thread`.
- `thread/resume` — Resume thread. Input: `ThreadResumeParams`: `approvalPolicy?`, `approvalsReviewer?`, `baseInstructions?`, `config?`, `cwd?`, `developerInstructions?`, `excludeTurns?`, `history?`, `initialTurnsPage?`, `model?`, `modelProvider?`, `path?`, `permissions?`, `personality?`, `runtimeWorkspaceRoots?`, `sandbox?`, `serviceTier?`, `threadId`. Output: `ThreadResumeResponse`: `activePermissionProfile?`, `approvalPolicy`, `approvalsReviewer`, `cwd`, `initialTurnsPage?`, `instructionSources?`, `itemsBackwardsCursor?`, `model`, `modelProvider`, `multiAgentMode?`, `reasoningEffort?`, `runtimeWorkspaceRoots?`, `sandbox`, `serviceTier?`, `thread`, `turnsBackwardsCursor?`.
- `thread/fork` — Fork thread. Input: `ThreadForkParams`: `approvalPolicy?`, `approvalsReviewer?`, `baseInstructions?`, `beforeTurnId?`, `config?`, `cwd?`, `deferGoalContinuation?`, `developerInstructions?`, `ephemeral?`, `excludeTurns?`, `lastTurnId?`, `model?`, `modelProvider?`, `path?`, `permissions?`, `runtimeWorkspaceRoots?`, `sandbox?`, `serviceTier?`, `threadId`, `threadSource?`. Output: `ThreadForkResponse`: `activePermissionProfile?`, `approvalPolicy`, `approvalsReviewer`, `cwd`, `instructionSources?`, `model`, `modelProvider`, `multiAgentMode?`, `reasoningEffort?`, `runtimeWorkspaceRoots?`, `sandbox`, `serviceTier?`, `thread`.
- `thread/archive` — Archive thread. Input: `ThreadArchiveParams`: `threadId`. Output: `ThreadArchiveResponse`: `{}`.
- `thread/delete` — Delete thread. Input: `ThreadDeleteParams`: `threadId`. Output: `ThreadDeleteResponse`: `{}`.
- `thread/unsubscribe` — Unsubscribe from thread. Input: `ThreadUnsubscribeParams`: `threadId`. Output: `ThreadUnsubscribeResponse`: `status`.
- `thread/increment_elicitation` — Increment elicitation state for thread. Input: `ThreadIncrementElicitationParams`: `threadId`. Output: `ThreadIncrementElicitationResponse`: `count`, `paused`.
- `thread/decrement_elicitation` — Decrement elicitation state for thread. Input: `ThreadDecrementElicitationParams`: `threadId`. Output: `ThreadDecrementElicitationResponse`: `count`, `paused`.
- `thread/name/set` — Set thread name. Input: `ThreadSetNameParams`: `name`, `threadId`. Output: `ThreadSetNameResponse`: `{}`.
- `thread/goal/set` — Set thread goal. Input: `ThreadGoalSetParams`: `objective?`, `status?`, `threadId`, `tokenBudget?`. Output: `ThreadGoalSetResponse`: `goal`.
- `thread/goal/get` — Read thread goal. Input: `ThreadGoalGetParams`: `threadId`. Output: `ThreadGoalGetResponse`: `goal?`.
- `thread/goal/clear` — Clear thread goal. Input: `ThreadGoalClearParams`: `threadId`. Output: `ThreadGoalClearResponse`: `cleared`.
- `thread/queue/add` — Add thread queue. Input: `ThreadQueueAddParams`: `clientUserMessageId`, `input`, `threadId`. Output: `ThreadQueueAddResponse`: `queuedSubmission`.
- `thread/queue/list` — List thread queue. Input: `ThreadQueueListParams`: `cursor?`, `limit?`, `threadId`. Output: `ThreadQueueListResponse`: `data`, `nextCursor?`.
- `thread/queue/update` — Update thread queue. Input: `ThreadQueueUpdateParams`: `input`, `queuedSubmissionId`, `threadId`. Output: `ThreadQueueUpdateResponse`: `queuedSubmission`.
- `thread/queue/delete` — Delete thread queue. Input: `ThreadQueueDeleteParams`: `queuedSubmissionId`, `threadId`. Output: `ThreadQueueDeleteResponse`: `deleted`.
- `thread/queue/reorder` — Reorder thread queue. Input: `ThreadQueueReorderParams`: `queuedSubmissionIds`, `threadId`. Output: `ThreadQueueReorderResponse`: `{}`.
- `thread/queue/start` — Start thread queue. Input: `ThreadQueueStartParams`: `queuedSubmissionId?`, `threadId`. Output: `ThreadQueueStartResponse`: `turn`.
- `thread/metadata/update` — Update thread metadata. Input: `ThreadMetadataUpdateParams`: `gitInfo?`, `projectId?`, `threadId`. Output: `ThreadMetadataUpdateResponse`: `thread`.
- `thread/section/move` — Move thread section. Input: `ThreadSectionMoveParams`: `beforeThreadId?`, `sectionId`, `threadId`. Output: `ThreadSectionMoveResponse`: `{}`.
- `thread/settings/update` — Update thread settings. Input: `ThreadSettingsUpdateParams`: `approvalPolicy?`, `approvalsReviewer?`, `collaborationMode?`, `cwd?`, `effort?`, `model?`, `multiAgentMode?`, `permissions?`, `personality?`, `sandboxPolicy?`, `serviceTier?`, `summary?`, `threadId`. Output: `ThreadSettingsUpdateResponse`: `{}`.
- `thread/memoryMode/set` — Set thread memoryMode. Input: `ThreadMemoryModeSetParams`: `mode`, `threadId`. Output: `ThreadMemoryModeSetResponse`: `{}`.
- `thread/unarchive` — Unarchive thread. Input: `ThreadUnarchiveParams`: `threadId`. Output: `ThreadUnarchiveResponse`: `thread`.
- `thread/compact/start` — Start thread compact. Input: `ThreadCompactStartParams`: `threadId`. Output: `ThreadCompactStartResponse`: `{}`.
- `thread/shellCommand` — Run a shell command in thread. Input: `ThreadShellCommandParams`: `command`, `threadId`, `timeoutMs?`. Output: `ThreadShellCommandResponse`: `{}`.
- `thread/approveGuardianDeniedAction` — Approve an action previously denied by Guardian. Input: `ThreadApproveGuardianDeniedActionParams`: `event`, `threadId`. Output: `ThreadApproveGuardianDeniedActionResponse`: `{}`.
- `thread/backgroundTerminals/clean` — Clean thread backgroundTerminals. Input: `ThreadBackgroundTerminalsCleanParams`: `threadId`. Output: `ThreadBackgroundTerminalsCleanResponse`: `{}`.
- `thread/backgroundTerminals/list` — List thread backgroundTerminals. Input: `ThreadBackgroundTerminalsListParams`: `cursor?`, `limit?`, `threadId`. Output: `ThreadBackgroundTerminalsListResponse`: `data`, `nextCursor?`.
- `thread/backgroundTerminals/terminate` — Terminate thread backgroundTerminals. Input: `ThreadBackgroundTerminalsTerminateParams`: `processId`, `threadId`. Output: `ThreadBackgroundTerminalsTerminateResponse`: `terminated`.
- `thread/rollback` — Roll back thread. Input: `ThreadRollbackParams`: `numTurns`, `threadId`. Output: `ThreadRollbackResponse`: `thread`.
- `thread/revert` — Revert thread. Input: `ThreadRevertParams`: `beforeTurnId`, `threadId`. Output: `ThreadRevertResponse`: `itemsBackwardsCursor?`, `thread`, `turnsBackwardsCursor?`.
- `thread/list` — List thread. Input: `ThreadListParams`: `ancestorThreadId?`, `archived?`, `cursor?`, `cwd?`, `limit?`, `modelProviders?`, `parentThreadId?`, `projectId?`, `searchTerm?`, `sectionId?`, `sortDirection?`, `sortKey?`, `sourceKinds?`, `useStateDbOnly?`. Output: `ThreadListResponse`: `backwardsCursor?`, `data`, `nextCursor?`.
- `thread/search` — Search thread. Input: `ThreadSearchParams`: `archived?`, `cursor?`, `limit?`, `searchTerm`, `sortDirection?`, `sortKey?`, `sourceKinds?`. Output: `ThreadSearchResponse`: `backwardsCursor?`, `data`, `nextCursor?`.
- `thread/searchOccurrences` — Search occurrences in thread. Input: `ThreadSearchOccurrencesParams`: `cursor?`, `limit?`, `searchTerm`, `threadId`. Output: `ThreadSearchOccurrencesResponse`: `data`, `nextCursor?`.
- `thread/loaded/list` — List thread loaded. Input: `ThreadLoadedListParams`: `cursor?`, `limit?`. Output: `ThreadLoadedListResponse`: `data`, `nextCursor?`.
- `thread/read` — Read thread. Input: `ThreadReadParams`: `includeTurns?`, `threadId`. Output: `ThreadReadResponse`: `thread`.
- `thread/turns/list` — List thread turns. Input: `ThreadTurnsListParams`: `cursor?`, `itemsView?`, `limit?`, `sortDirection?`, `threadId`. Output: `ThreadTurnsListResponse`: `backwardsCursor?`, `data`, `nextCursor?`.
- `thread/items/list` — List thread items. Input: `ThreadItemsListParams`: `cursor?`, `limit?`, `sortDirection?`, `threadId`, `turnId?`. Output: `ThreadItemsListResponse`: `backwardsCursor?`, `data`, `nextCursor?`.
- `thread/inject_items` — Inject history items into thread. Input: `ThreadInjectItemsParams`: `items`, `threadId`. Output: `ThreadInjectItemsResponse`: `{}`.
- `thread/realtime/start` — Start thread realtime. Input: `ThreadRealtimeStartParams`: `clientManagedHandoffs?`, `codexResponseHandoffChannelPrefixes?`, `codexResponseHandoffMode?`, `codexResponseItemPrefix?`, `codexResponsesAsItems?`, `delegationAckFiller?`, `flushTranscriptTailOnSessionEnd?`, `includeStartupContext?`, `initialItems?`, `model?`, `outputModality`, `prompt?`, `realtimeEndInstructions?`, `realtimeSessionId?`, `realtimeStartInstructions?`, `threadId`, `transport?`, `version?`, `voice?`. Output: `ThreadRealtimeStartResponse`: `{}`.
- `thread/realtime/appendAudio` — Append audio to thread realtime. Input: `ThreadRealtimeAppendAudioParams`: `audio`, `threadId`. Output: `ThreadRealtimeAppendAudioResponse`: `{}`.
- `thread/realtime/appendText` — Append text to thread realtime. Input: `ThreadRealtimeAppendTextParams`: `role?`, `text`, `threadId`. Output: `ThreadRealtimeAppendTextResponse`: `{}`.
- `thread/realtime/appendSpeech` — Append speech to thread realtime. Input: `ThreadRealtimeAppendSpeechParams`: `text`, `threadId`. Output: `ThreadRealtimeAppendSpeechResponse`: `{}`.
- `thread/realtime/stop` — Stop thread realtime. Input: `ThreadRealtimeStopParams`: `threadId`. Output: `ThreadRealtimeStopResponse`: `{}`.
- `thread/timeline/list` — List thread timeline. Input: `ThreadTimelineListParams`: `cursor?`, `limit?`, `threadId`. Output: `ThreadTimelineListResponse`: `activeRealtimeSessionAtPageStart?`, `data`, `nextCursor?`.
- `thread/realtime/listVoices` — List voices for thread realtime. Input: `ThreadRealtimeListVoicesParams`: `{}`. Output: `ThreadRealtimeListVoicesResponse`: `voices`.

### Memory

- `memory/reset` — Reset memory. Input: `undefined` (omit `params`). Output: `MemoryResetResponse`: `{}`.

### Project

- `project/list` — List project. Input: `ProjectListParams`: `cursor?`, `limit?`, `sortDirection?`, `sortKey?`. Output: `ProjectListResponse`: `data`, `nextCursor?`.
- `project/read` — Read project. Input: `ProjectReadParams`: `projectId`. Output: `ProjectReadResponse`: `project`.
- `project/create` — Create project. Input: `ProjectCreateParams`: `idempotencyKey`, `metadata?`, `name`, `roots`. Output: `ProjectCreateResponse`: `project`.
- `project/import` — Import project. Input: `ProjectImportParams`: `idempotencyKey`, `metadata?`, `name`, `roots`, `threads?`. Output: `ProjectImportResponse`: `project`.
- `project/update` — Update project. Input: `ProjectUpdateParams`: `metadata?`, `name?`, `projectId`, `roots?`. Output: `ProjectUpdateResponse`: `project`.
- `project/move` — Move project. Input: `ProjectMoveParams`: `beforeProjectId?`, `projectId`. Output: `ProjectMoveResponse`: `{}`.
- `project/delete` — Delete project. Input: `ProjectDeleteParams`: `projectId`. Output: `ProjectDeleteResponse`: `{}`.

### Thread section

- `threadSection/list` — List thread section. Input: `ThreadSectionListParams`: `cursor?`, `limit?`. Output: `ThreadSectionListResponse`: `data`, `nextCursor?`.
- `threadSection/create` — Create thread section. Input: `ThreadSectionCreateParams`: `appearance?`, `name`. Output: `ThreadSectionCreateResponse`: `section`.
- `threadSection/update` — Update thread section. Input: `ThreadSectionUpdateParams`: `appearance?`, `name`, `sectionId`. Output: `ThreadSectionUpdateResponse`: `section`.
- `threadSection/delete` — Delete thread section. Input: `ThreadSectionDeleteParams`: `sectionId`. Output: `ThreadSectionDeleteResponse`: `{}`.

### Skills

- `skills/list` — List skills. Input: `SkillsListParams`: `cwds?`, `forceReload?`. Output: `SkillsListResponse`: `data`.
- `skills/extraRoots/set` — Set skills extraRoots. Input: `SkillsExtraRootsSetParams`: `extraRoots`. Output: `SkillsExtraRootsSetResponse`: `{}`.
- `skills/config/write` — Write skills config. Input: `SkillsConfigWriteParams`: `enabled`, `name?`, `path?`. Output: `SkillsConfigWriteResponse`: `effectiveEnabled`.

### Hooks

- `hooks/list` — List hooks. Input: `HooksListParams`: `cwds?`. Output: `HooksListResponse`: `data`.

### Marketplace

- `marketplace/add` — Add marketplace. Input: `MarketplaceAddParams`: `refName?`, `source`, `sparsePaths?`. Output: `MarketplaceAddResponse`: `alreadyAdded`, `installedRoot`, `marketplaceName`.
- `marketplace/remove` — Remove marketplace. Input: `MarketplaceRemoveParams`: `marketplaceName`. Output: `MarketplaceRemoveResponse`: `installedRoot?`, `marketplaceName`.
- `marketplace/upgrade` — Upgrade marketplace. Input: `MarketplaceUpgradeParams`: `marketplaceName?`. Output: `MarketplaceUpgradeResponse`: `errors`, `selectedMarketplaces`, `upgradedRoots`.

### Plugins

- `plugin/list` — List plugins. Input: `PluginListParams`: `cwds?`, `forceRefetch?`, `marketplaceKinds?`. Output: `PluginListResponse`: `featuredPluginIds?`, `marketplaceLoadErrors?`, `marketplaces`.
- `plugin/search` — Search plugins. Input: `PluginSearchParams`: `cursor?`, `cwds?`, `limit?`, `scope?`, `searchTerm`. Output: `PluginSearchResponse`: `data`, `nextCursor?`.
- `plugin/installed` — List installed plugins. Input: `PluginInstalledParams`: `cwds?`, `installSuggestionPluginNames?`. Output: `PluginInstalledResponse`: `marketplaceLoadErrors?`, `marketplaces`.
- `plugin/reconcile` — Reconcile plugins. Input: `PluginReconcileParams`: `reason?`. Output: `PluginReconcileResponse`: `changedPlugins`, `failedMaterializationRemotePluginIds`, `failedRemotePluginIds`.
- `plugin/read` — Read plugins. Input: `PluginReadParams`: `marketplacePath?`, `pluginName`, `remoteMarketplaceName?`. Output: `PluginReadResponse`: `plugin`.
- `plugin/skill/read` — Read plugins skill. Input: `PluginSkillReadParams`: `remoteMarketplaceName`, `remotePluginId`, `skillName`. Output: `PluginSkillReadResponse`: `contents?`.
- `plugin/share/save` — Save plugins share. Input: `PluginShareSaveParams`: `discoverability?`, `pluginPath`, `remotePluginId?`, `shareTargets?`. Output: `PluginShareSaveResponse`: `canPublishToWorkspace?`, `remotePluginId`, `shareUrl`.
- `plugin/share/updateTargets` — Update sharing targets for plugins share. Input: `PluginShareUpdateTargetsParams`: `discoverability`, `remotePluginId`, `shareTargets`. Output: `PluginShareUpdateTargetsResponse`: `discoverability`, `principals`.
- `plugin/share/list` — List plugins share. Input: `PluginShareListParams`: `{}`. Output: `PluginShareListResponse`: `data`.
- `plugin/share/checkout` — Check out plugins share. Input: `PluginShareCheckoutParams`: `remotePluginId`. Output: `PluginShareCheckoutResponse`: `marketplaceName`, `marketplacePath`, `pluginId`, `pluginName`, `pluginPath`, `remotePluginId`, `remoteVersion?`.
- `plugin/share/delete` — Delete plugins share. Input: `PluginShareDeleteParams`: `remotePluginId`. Output: `PluginShareDeleteResponse`: `{}`.
- `plugin/install` — Install plugins. Input: `PluginInstallParams`: `installAttemptId?`, `marketplacePath?`, `pluginName`, `remoteMarketplaceName?`. Output: `PluginInstallResponse`: `appsNeedingAuth`, `authPolicy`.
- `plugin/uninstall` — Uninstall plugins. Input: `PluginUninstallParams`: `pluginId`. Output: `PluginUninstallResponse`: `{}`.

### Apps

- `app/read` — Read apps. Input: `AppsReadParams`: `appIds`, `includeTools?`, `threadId?`. Output: `AppsReadResponse`: `apps`, `missingAppIds`.
- `app/list` — List apps. Input: `AppsListParams`: `cursor?`, `forceRefetch?`, `limit?`, `threadId?`. Output: `AppsListResponse`: `data`, `nextCursor?`.
- `app/installed` — List installed apps. Input: `AppsInstalledParams`: `forceRefresh?`, `threadId?`. Output: `AppsInstalledResponse`: `apps`.

### Filesystem

- `fs/readFile` — Read file filesystem. Input: `FsReadFileParams`: `path`. Output: `FsReadFileResponse`: `dataBase64`.
- `fs/writeFile` — Write file filesystem. Input: `FsWriteFileParams`: `dataBase64`, `path`. Output: `FsWriteFileResponse`: `{}`.
- `fs/createDirectory` — Create a directory in filesystem. Input: `FsCreateDirectoryParams`: `path`, `recursive?`. Output: `FsCreateDirectoryResponse`: `{}`.
- `fs/getMetadata` — Read metadata for filesystem. Input: `FsGetMetadataParams`: `path`. Output: `FsGetMetadataResponse`: `createdAtMs`, `isDirectory`, `isFile`, `isSymlink`, `modifiedAtMs`.
- `fs/readDirectory` — Read directory filesystem. Input: `FsReadDirectoryParams`: `path`. Output: `FsReadDirectoryResponse`: `entries`.
- `fs/remove` — Remove filesystem. Input: `FsRemoveParams`: `force?`, `path`, `recursive?`. Output: `FsRemoveResponse`: `{}`.
- `fs/copy` — Copy within filesystem. Input: `FsCopyParams`: `destinationPath`, `recursive?`, `sourcePath`. Output: `FsCopyResponse`: `{}`.
- `fs/watch` — Watch filesystem. Input: `FsWatchParams`: `path`, `watchId`. Output: `FsWatchResponse`: `path`.
- `fs/unwatch` — Stop watching filesystem. Input: `FsUnwatchParams`: `watchId`. Output: `FsUnwatchResponse`: `{}`.

### Turn

- `turn/start` — Start turn. Input: `TurnStartParams`: `additionalContext?`, `approvalPolicy?`, `approvalsReviewer?`, `clientUserMessageId?`, `collaborationMode?`, `cwd?`, `cyberAccessProgram?`, `effort?`, `environments?`, `input`, `model?`, `multiAgentMode?`, `outputSchema?`, `permissions?`, `personality?`, `responsesapiClientMetadata?`, `runtimeWorkspaceRoots?`, `sandboxPolicy?`, `serviceTier?`, `serviceTierForTurn?`, `summary?`, `threadId`, `toolOutput?`, `turnTrigger?`. Output: `TurnStartResponse`: `turn`.
- `turn/settings/update` — Update turn settings. Input: `TurnSettingsUpdateParams`: `approvalsReviewer?`, `effort?`, `model?`, `serviceTier?`, `summary?`, `threadId`, `turnId`. Output: `TurnSettingsUpdateResponse`: `status`.
- `turn/steer` — Steer turn. Input: `TurnSteerParams`: `additionalContext?`, `clientUserMessageId?`, `expectedTurnId`, `input`, `responsesapiClientMetadata?`, `threadId`. Output: `TurnSteerResponse`: `turnId`.
- `turn/interrupt` — Interrupt turn. Input: `TurnInterruptParams`: `threadId`, `turnId`. Output: `TurnInterruptResponse`: `{}`.

### Review

- `review/start` — Start review. Input: `ReviewStartParams`: `delivery?`, `target`, `threadId`. Output: `ReviewStartResponse`: `reviewThreadId`, `turn`.

### Models

- `model/list` — List models. Input: `ModelListParams`: `cursor?`, `includeHidden?`, `limit?`. Output: `ModelListResponse`: `data`, `nextCursor?`.

### Model provider

- `modelProvider/capabilities/read` — Read model provider capabilities. Input: `ModelProviderCapabilitiesReadParams`: `{}`. Output: `ModelProviderCapabilitiesReadResponse`: `imageGeneration`, `namespaceTools`, `webSearch`.

### Experimental feature

- `experimentalFeature/list` — List experimental feature. Input: `ExperimentalFeatureListParams`: `cursor?`, `limit?`, `threadId?`. Output: `ExperimentalFeatureListResponse`: `data`, `nextCursor?`.
- `experimentalFeature/enablement/set` — Set experimental feature enablement. Input: `ExperimentalFeatureEnablementSetParams`: `enablement`. Output: `ExperimentalFeatureEnablementSetResponse`: `enablement`.

### Permission profiles

- `permissionProfile/list` — List permission profiles. Input: `PermissionProfileListParams`: `cursor?`, `cwd?`, `limit?`. Output: `PermissionProfileListResponse`: `data`, `nextCursor?`.

### Remote control

- `remoteControl/enable` — Enable remote control. Input: `RemoteControlEnableParams | null`. Output: `RemoteControlEnableResponse`: `environmentId?`, `installationId`, `serverName`, `status`.
- `remoteControl/disable` — Disable remote control. Input: `RemoteControlDisableParams | null`. Output: `RemoteControlDisableResponse`: `environmentId?`, `installationId`, `serverName`, `status`.
- `remoteControl/status/read` — Read remote control status. Input: `undefined` (omit `params`). Output: `RemoteControlStatusReadResponse`: `environmentId?`, `installationId`, `serverName`, `status`.
- `remoteControl/pairing/start` — Start remote control pairing. Input: `RemoteControlPairingStartParams`: `manualCode?`. Output: `RemoteControlPairingStartResponse`: `environmentId`, `expiresAt`, `manualPairingCode?`, `pairingCode`.
- `remoteControl/pairing/status` — Read status for remote control pairing. Input: `RemoteControlPairingStatusParams`: `manualPairingCode?`, `pairingCode?`. Output: `RemoteControlPairingStatusResponse`: `claimed`.
- `remoteControl/client/list` — List remote control client. Input: `RemoteControlClientsListParams`: `cursor?`, `environmentId`, `limit?`, `order?`. Output: `RemoteControlClientsListResponse`: `data`, `nextCursor?`.
- `remoteControl/client/revoke` — Revoke remote control client. Input: `RemoteControlClientsRevokeParams`: `clientId`, `environmentId`. Output: `RemoteControlClientsRevokeResponse`: `{}`.

### Collaboration modes

- `collaborationMode/list` — List collaboration modes. Input: `CollaborationModeListParams`: `{}`. Output: `CollaborationModeListResponse`: `data`.

### mock

- `mock/experimentalMethod` — Perform mock/experimentalMethod. Input: `MockExperimentalMethodParams`: `value?`. Output: `MockExperimentalMethodResponse`: `echoed?`.

### Environment

- `environment/add` — Add environment. Input: `EnvironmentAddParams`: `connectTimeoutMs?`, `environmentId`, `execServerUrl`. Output: `EnvironmentAddResponse`: `{}`.
- `environment/info` — Read information for environment. Input: `EnvironmentInfoParams`: `environmentId`. Output: `EnvironmentInfoResponse`: `cwd?`, `shell`.
- `environment/status` — Read status for environment. Input: `EnvironmentStatusParams`: `environmentId`. Output: `EnvironmentStatusResponse`: `error?`, `status`.

### MCP server

- `mcpServer/oauth/login` — Start login for MCP server oauth. Input: `McpServerOauthLoginParams`: `clientRegistration?`, `name`, `scopes?`, `threadId?`, `timeoutSecs?`. Output: `McpServerOauthLoginResponse`: `authorizationUrl`.
- `mcpServer/resource/read` — Read MCP server resource. Input: `McpResourceReadParams`: `connectorId?`, `originCallId?`, `server`, `threadId?`, `uri`. Output: `McpResourceReadResponse`: `contents`, `originCallId?`.
- `mcpServer/event/stream/start` — Start MCP server event/stream. Input: `McpServerEventStreamStartParams`: `_meta?`, `arguments`, `name`, `server`, `subscriptionId`, `threadId`. Output: `McpServerEventStreamStartResponse`: `{}`.
- `mcpServer/event/stream/stop` — Stop MCP server event/stream. Input: `McpServerEventStreamStopParams`: `subscriptionId`. Output: `McpServerEventStreamStopResponse`: `{}`.
- `mcpServer/tool/call` — Perform mcpServer/tool/call. Input: `McpServerToolCallParams`: `_meta?`, `arguments?`, `server`, `threadId`, `tool`. Output: `McpServerToolCallResponse`: `_meta?`, `content`, `isError?`, `structuredContent?`.

### Configuration

- `config/mcpServer/reload` — Reload configuration mcpServer. Input: `undefined` (omit `params`). Output: `McpServerRefreshResponse`: `{}`.
- `config/read` — Read configuration. Input: `ConfigReadParams`: `cwd?`, `includeLayers?`. Output: `ConfigReadResponse`: `config`, `layers?`, `origins`.
- `config/value/write` — Write configuration value. Input: `ConfigValueWriteParams`: `expectedVersion?`, `filePath?`, `keyPath`, `mergeStrategy`, `value`. Output: `ConfigWriteResponse`: `filePath`, `overriddenMetadata?`, `status`, `version`.
- `config/batchWrite` — Perform config/batchWrite. Input: `ConfigBatchWriteParams`: `edits`, `expectedVersion?`, `filePath?`, `reloadUserConfig?`. Output: `ConfigWriteResponse`: `filePath`, `overriddenMetadata?`, `status`, `version`.

### mcpServerStatus

- `mcpServerStatus/list` — List mcpServerStatus. Input: `ListMcpServerStatusParams`: `cursor?`, `detail?`, `limit?`, `threadId?`. Output: `ListMcpServerStatusResponse`: `data`, `nextCursor?`.

### Windows sandbox

- `windowsSandbox/setupStart` — Start setup for Windows sandbox. Input: `WindowsSandboxSetupStartParams`: `cwd?`, `mode`. Output: `WindowsSandboxSetupStartResponse`: `started`.
- `windowsSandbox/readiness` — Read readiness for Windows sandbox. Input: `undefined` (omit `params`). Output: `WindowsSandboxReadinessResponse`: `status`.

### Account

- `account/login/start` — Start an API-key, ChatGPT, or external-token login flow. Input: `LoginAccountParams`: `apiKey`, `type`, `appBrand?`, `codexStreamlinedLogin?`, `useHostedLoginSuccessPage?`, `accessToken`, `chatgptAccountId`, `chatgptPlanType?`, `region`, `accessKeyId`, `secretAccessKey`, `sessionToken?`. Output: `LoginAccountResponse`: `type`, `authUrl`, `loginId`, `userCode`, `verificationUrl`.
- `account/bedrock/discover` — Discover account bedrock. Input: `BedrockDiscoverParams`: `{}`. Output: `BedrockDiscoverResponse`: `environmentCredentials`, `profiles`.
- `account/bedrock/setup` — Set up account bedrock. Input: `BedrockSetupParams`: `profile`, `region`, `type`. Output: `BedrockSetupResponse`: `{}`.
- `account/login/cancel` — Cancel account login. Input: `CancelLoginAccountParams`: `loginId`. Output: `CancelLoginAccountResponse`: `status`.
- `account/logout` — Perform account/logout. Input: `undefined` (omit `params`). Output: `LogoutAccountResponse`: `{}`.
- `account/rateLimits/read` — Read account rateLimits. Input: `undefined` (omit `params`). Output: `GetAccountRateLimitsResponse`: `accountId?`, `rateLimitResetCredits?`, `rateLimitUpsell?`, `rateLimits`, `rateLimitsByLimitId?`.
- `account/rateLimitResetCredit/consume` — Consume account rateLimitResetCredit. Input: `ConsumeAccountRateLimitResetCreditParams`: `creditId?`, `idempotencyKey`. Output: `ConsumeAccountRateLimitResetCreditResponse`: `outcome`.
- `account/usage/read` — Read account usage. Input: `GetAccountTokenUsageParams`: `threadId?`; `params` itself is optional. Output: `GetAccountTokenUsageResponse`: `dailyUsageBuckets?`, `summary`, `threadUsage?`.
- `account/workspaceMessages/read` — Read account workspaceMessages. Input: `undefined` (omit `params`). Output: `GetWorkspaceMessagesResponse`: `featureEnabled`, `messages`.
- `account/sendAddCreditsNudgeEmail` — Send an add-credits nudge email for account. Input: `SendAddCreditsNudgeEmailParams`: `creditType`. Output: `SendAddCreditsNudgeEmailResponse`: `status`.
- `account/read` — Read account. Input: `GetAccountParams`: `refreshToken?`. Output: `GetAccountResponse`: `account?`, `requiresOpenaiAuth`.

### Feedback

- `feedback/upload` — Perform feedback/upload. Input: `FeedbackUploadParams`: `classification`, `extraLogFiles?`, `includeLogs?`, `reason?`, `tags?`, `threadId?`. Output: `FeedbackUploadResponse`: `threadId`.

### Sandboxed command

- `command/exec` — Perform command/exec. Input: `CommandExecParams`: `command`, `cwd?`, `disableOutputCap?`, `disableTimeout?`, `env?`, `outputBytesCap?`, `permissionProfile?`, `processId?`, `sandboxPolicy?`, `size?`, `streamStdin?`, `streamStdoutStderr?`, `timeoutMs?`, `tty?`. Output: `CommandExecResponse`: `exitCode`, `stderr`, `stdout`.
- `command/exec/write` — Write sandboxed command exec. Input: `CommandExecWriteParams`: `closeStdin?`, `deltaBase64?`, `processId`. Output: `CommandExecWriteResponse`: `{}`.
- `command/exec/terminate` — Terminate sandboxed command exec. Input: `CommandExecTerminateParams`: `processId`. Output: `CommandExecTerminateResponse`: `{}`.
- `command/exec/resize` — Resize sandboxed command exec. Input: `CommandExecResizeParams`: `processId`, `size`. Output: `CommandExecResizeResponse`: `{}`.

### Unsandboxed process

- `process/spawn` — Spawn unsandboxed process. Input: `ProcessSpawnParams`: `command`, `cwd`, `env?`, `outputBytesCap?`, `processHandle`, `size?`, `streamStdin?`, `streamStdoutStderr?`, `timeoutMs?`, `tty?`. Output: `ProcessSpawnResponse`: `{}`.
- `process/writeStdin` — Write stdin to unsandboxed process. Input: `ProcessWriteStdinParams`: `closeStdin?`, `deltaBase64?`, `processHandle`. Output: `ProcessWriteStdinResponse`: `{}`.
- `process/kill` — Kill unsandboxed process. Input: `ProcessKillParams`: `processHandle`. Output: `ProcessKillResponse`: `{}`.
- `process/resizePty` — Resize PTY for unsandboxed process. Input: `ProcessResizePtyParams`: `processHandle`, `size`. Output: `ProcessResizePtyResponse`: `{}`.

### External agent configuration

- `externalAgentConfig/detect` — Detect external agent configuration. Input: `ExternalAgentConfigDetectParams`: `cwds?`, `includeHome?`, `maxSessionAgeDays?`, `maxSessions?`, `migrationSource?`, `source?`. Output: `ExternalAgentConfigDetectResponse`: `connectors?`, `items`.
- `externalAgentConfig/import` — Import external agent configuration. Input: `ExternalAgentConfigImportParams`: `migrationItems`, `migrationSource?`, `providerId?`, `source?`. Output: `ExternalAgentConfigImportResponse`: `importId`.
- `externalAgentConfig/import/recordHistory` — Record import history for external agent configuration import. Input: `ExternalAgentConfigImportHistoryRecordParams`: `itemTypeResults`, `providerId`. Output: `ExternalAgentConfigImportHistoryRecordResponse`: `importId`.
- `externalAgentConfig/import/readHistories` — Read import histories for external agent configuration import. Input: `undefined` (omit `params`). Output: `ExternalAgentConfigImportHistoriesReadResponse`: `connectors`, `data`.

### Configuration requirements

- `configRequirements/read` — Read configuration requirements. Input: `undefined` (omit `params`). Output: `ConfigRequirementsReadResponse`: `requirements?`.

### Legacy helpers

- `getConversationSummary` — Read a legacy conversation summary by rollout path or conversation id. Input: `GetConversationSummaryParams`: `rolloutPath | conversationId`. Output: `GetConversationSummaryResponse`: `summary`.
- `gitDiffToRemote` — Compute the Git diff from the working tree to its remote base. Input: `GitDiffToRemoteParams`: `cwd`. Output: `GitDiffToRemoteResponse`: `sha`, `diff`.
- `getAuthStatus` — Read the legacy authentication state and optionally return/refresh the token. Input: `GetAuthStatusParams`: `includeToken?`, `refreshToken?`. Output: `GetAuthStatusResponse`: `authMethod?`, `authToken?`, `requiresOpenaiAuth?`.

### Fuzzy file search

- `fuzzyFileSearch` — Perform fuzzyFileSearch. Input: `FuzzyFileSearchParams`: `cancellationToken?`, `query`, `roots`. Output: `FuzzyFileSearchResponse`: `files`.
- `fuzzyFileSearch/sessionStart` — Start a session for fuzzy file search. Input: `FuzzyFileSearchSessionStartParams`: `roots`, `sessionId`. Output: `FuzzyFileSearchSessionStartResponse`: `{}`.
- `fuzzyFileSearch/sessionUpdate` — Update a session for fuzzy file search. Input: `FuzzyFileSearchSessionUpdateParams`: `query`, `sessionId`. Output: `FuzzyFileSearchSessionUpdateResponse`: `{}`.
- `fuzzyFileSearch/sessionStop` — Stop a session for fuzzy file search. Input: `FuzzyFileSearchSessionStopParams`: `sessionId`. Output: `FuzzyFileSearchSessionStopResponse`: `{}`.

## Server-initiated requests (11)

These are reverse RPC calls. The client must return the listed response rather than treating them as notifications.

### item

- `item/commandExecution/requestApproval` — Ask the client to approve a command execution. Input: `CommandExecutionRequestApprovalParams`: `additionalPermissions?`, `approvalId?`, `availableDecisions?`, `command?`, `commandActions?`, `cwd?`, `environmentId?`, `itemId`, `kind?`, `networkApprovalContext?`, `proposedExecpolicyAmendment?`, `proposedNetworkPolicyAmendments?`, `reason?`, `startedAtMs`, `threadId`, `turnId`. Output: `CommandExecutionRequestApprovalResponse`: `decision`.
- `item/fileChange/requestApproval` — Ask the client to approve file changes. Input: `FileChangeRequestApprovalParams`: `grantRoot?`, `itemId`, `reason?`, `startedAtMs`, `threadId`, `turnId`. Output: `FileChangeRequestApprovalResponse`: `decision`.
- `item/tool/requestUserInput` — Ask the client to collect structured user input for a tool. Input: `ToolRequestUserInputParams`: `autoResolutionMs?`, `isBlocking`, `itemId`, `questions`, `threadId`, `turnId`. Output: `ToolRequestUserInputResponse`: `answers`.
- `item/permissions/requestApproval` — Ask the client to approve additional permissions. Input: `PermissionsRequestApprovalParams`: `cwd`, `environmentId?`, `itemId`, `permissions`, `reason?`, `startedAtMs`, `threadId`, `turnId`. Output: `PermissionsRequestApprovalResponse`: `permissions`, `scope?`, `strictAutoReview?`.
- `item/tool/call` — Ask the client to execute a registered dynamic tool. Input: `DynamicToolCallParams`: `arguments`, `callId`, `namespace?`, `threadId`, `tool`, `turnId`. Output: `DynamicToolCallResponse`: `contentItems`, `success`.

### MCP server

- `mcpServer/elicitation/request` — Ask the client to answer an MCP elicitation. Input: `McpServerElicitationRequestParams`: `serverName`, `threadId`, `turnId?`. Output: `McpServerElicitationRequestResponse`: `_meta?`, `action`, `content?`.

### Account

- `account/chatgptAuthTokens/refresh` — Ask the client to refresh ChatGPT authentication tokens. Input: `ChatgptAuthTokensRefreshParams`: `previousAccountId?`, `reason`. Output: `ChatgptAuthTokensRefreshResponse`: `accessToken`, `chatgptAccountId`, `chatgptPlanType?`.

### attestation

- `attestation/generate` — Ask the client to generate a fresh attestation token. Input: `AttestationGenerateParams`: `{}`. Output: `AttestationGenerateResponse`: `token`.

### currentTime

- `currentTime/read` — Read time from the client-owned external clock. Input: `CurrentTimeReadParams`: `threadId`. Output: `CurrentTimeReadResponse`: `currentTimeAt`.

### applyPatchApproval

- `applyPatchApproval` — Legacy request for patch approval. Input: `ApplyPatchApprovalParams`: `callId`, `conversationId`, `fileChanges`, `grantRoot?`, `reason?`. Output: `ApplyPatchApprovalResponse`: `decision`.

### execCommandApproval

- `execCommandApproval` — Legacy request for command execution approval. Input: `ExecCommandApprovalParams`: `approvalId?`, `callId`, `command`, `conversationId`, `cwd`, `parsedCmd`, `reason?`. Output: `ExecCommandApprovalResponse`: `decision`.

## Server notifications (83)

### error

- `error` — Reports the `error` event. Payload: `ErrorNotification`: `error`, `threadId`, `turnId`, `willRetry`.

### Thread

- `thread/started` — Reports the `thread/started` event. Payload: `ThreadStartedNotification`: `thread`.
- `thread/status/changed` — Reports the `thread/status/changed` event. Payload: `ThreadStatusChangedNotification`: `status`, `threadId`.
- `thread/archived` — Reports the `thread/archived` event. Payload: `ThreadArchivedNotification`: `threadId`.
- `thread/deleted` — Reports the `thread/deleted` event. Payload: `ThreadDeletedNotification`: `threadId`.
- `thread/unarchived` — Reports the `thread/unarchived` event. Payload: `ThreadUnarchivedNotification`: `threadId`.
- `thread/closed` — Reports the `thread/closed` event. Payload: `ThreadClosedNotification`: `threadId`.
- `thread/reverted` — Reports the `thread/reverted` event. Payload: `ThreadRevertedNotification`: `threadId`.
- `thread/name/updated` — Reports the `thread/name/updated` event. Payload: `ThreadNameUpdatedNotification`: `threadId`, `threadName?`.
- `thread/goal/updated` — Reports the `thread/goal/updated` event. Payload: `ThreadGoalUpdatedNotification`: `goal`, `threadId`, `turnId?`.
- `thread/goal/cleared` — Reports the `thread/goal/cleared` event. Payload: `ThreadGoalClearedNotification`: `threadId`.
- `thread/queue/changed` — Reports the `thread/queue/changed` event. Payload: `ThreadQueueChangedNotification`: `threadId`.
- `thread/project/updated` — Reports the `thread/project/updated` event. Payload: `ThreadProjectUpdatedNotification`: `projectId`, `threadId`.
- `thread/environment/connected` — Reports the `thread/environment/connected` event. Payload: `EnvironmentConnectionNotification`: `environmentId`, `threadId`.
- `thread/environment/disconnected` — Reports the `thread/environment/disconnected` event. Payload: `EnvironmentConnectionNotification`: `environmentId`, `threadId`.
- `thread/settings/updated` — Reports the `thread/settings/updated` event. Payload: `ThreadSettingsUpdatedNotification`: `threadId`, `threadSettings`.
- `thread/tokenUsage/updated` — Reports the `thread/tokenUsage/updated` event. Payload: `ThreadTokenUsageUpdatedNotification`: `threadId`, `tokenUsage`, `turnId`.
- `thread/compacted` — Reports the `thread/compacted` event. Payload: `ContextCompactedNotification`: `threadId`, `turnId`.
- `thread/realtime/started` — Reports the `thread/realtime/started` event. Payload: `ThreadRealtimeStartedNotification`: `realtimeSessionId?`, `threadId`, `version`.
- `thread/realtime/itemAdded` — Reports the `thread/realtime/itemAdded` event. Payload: `ThreadRealtimeItemAddedNotification`: `item`, `threadId`.
- `thread/realtime/item/started` — Reports the `thread/realtime/item/started` event. Payload: `ThreadRealtimeItemStartedNotification`: `item`, `threadId`.
- `thread/realtime/item/transcript/delta` — Reports the `thread/realtime/item/transcript/delta` event. Payload: `ThreadRealtimeItemTranscriptDeltaNotification`: `delta`, `itemId`, `threadId`.
- `thread/realtime/item/completed` — Reports the `thread/realtime/item/completed` event. Payload: `ThreadRealtimeItemCompletedNotification`: `item`, `threadId`.
- `thread/realtime/transcript/delta` — Reports the `thread/realtime/transcript/delta` event. Payload: `ThreadRealtimeTranscriptDeltaNotification`: `delta`, `role`, `threadId`.
- `thread/realtime/transcript/done` — Reports the `thread/realtime/transcript/done` event. Payload: `ThreadRealtimeTranscriptDoneNotification`: `role`, `text`, `threadId`.
- `thread/realtime/outputAudio/delta` — Reports the `thread/realtime/outputAudio/delta` event. Payload: `ThreadRealtimeOutputAudioDeltaNotification`: `audio`, `threadId`.
- `thread/realtime/sdp` — Reports the `thread/realtime/sdp` event. Payload: `ThreadRealtimeSdpNotification`: `sdp`, `threadId`.
- `thread/realtime/error` — Reports the `thread/realtime/error` event. Payload: `ThreadRealtimeErrorNotification`: `message`, `threadId`.
- `thread/realtime/closed` — Reports the `thread/realtime/closed` event. Payload: `ThreadRealtimeClosedNotification`: `reason?`, `threadId`.

### Skills

- `skills/changed` — Reports the `skills/changed` event. Payload: `SkillsChangedNotification`: `{}`.

### Project

- `project/changed` — Reports the `project/changed` event. Payload: `ProjectChangedNotification`: `changeType`, `projectId`.

### Turn

- `turn/started` — Reports the `turn/started` event. Payload: `TurnStartedNotification`: `threadId`, `turn`.
- `turn/completed` — Reports the `turn/completed` event. Payload: `TurnCompletedNotification`: `threadId`, `turn`.
- `turn/diff/updated` — Reports the `turn/diff/updated` event. Payload: `TurnDiffUpdatedNotification`: `diff`, `threadId`, `turnId`.
- `turn/plan/updated` — Reports the `turn/plan/updated` event. Payload: `TurnPlanUpdatedNotification`: `explanation?`, `plan`, `threadId`, `turnId`.
- `turn/moderationMetadata` — Reports the `turn/moderationMetadata` event. Payload: `TurnModerationMetadataNotification`: `metadata`, `threadId`, `turnId`.

### hook

- `hook/started` — Reports the `hook/started` event. Payload: `HookStartedNotification`: `run`, `threadId`, `turnId?`.
- `hook/completed` — Reports the `hook/completed` event. Payload: `HookCompletedNotification`: `run`, `threadId`, `turnId?`.

### item

- `item/started` — Reports the `item/started` event. Payload: `ItemStartedNotification`: `item`, `startedAtMs`, `threadId`, `turnId`.
- `item/autoApprovalReview/started` — Reports the `item/autoApprovalReview/started` event. Payload: `ItemGuardianApprovalReviewStartedNotification`: `action`, `review`, `reviewId`, `startedAtMs`, `targetItemId?`, `threadId`, `turnId`.
- `item/autoApprovalReview/completed` — Reports the `item/autoApprovalReview/completed` event. Payload: `ItemGuardianApprovalReviewCompletedNotification`: `action`, `completedAtMs`, `decisionSource`, `review`, `reviewId`, `startedAtMs`, `targetItemId?`, `threadId`, `turnId`.
- `item/completed` — Reports the `item/completed` event. Payload: `ItemCompletedNotification`: `completedAtMs`, `item`, `threadId`, `turnId`.
- `item/agentMessage/delta` — Reports the `item/agentMessage/delta` event. Payload: `AgentMessageDeltaNotification`: `delta`, `itemId`, `threadId`, `turnId`.
- `item/plan/delta` — Reports the `item/plan/delta` event. Payload: `PlanDeltaNotification`: `delta`, `itemId`, `threadId`, `turnId`.
- `item/commandExecution/outputDelta` — Reports the `item/commandExecution/outputDelta` event. Payload: `CommandExecutionOutputDeltaNotification`: `delta`, `itemId`, `threadId`, `turnId`.
- `item/commandExecution/terminalInteraction` — Reports the `item/commandExecution/terminalInteraction` event. Payload: `TerminalInteractionNotification`: `itemId`, `processId`, `stdin`, `threadId`, `turnId`.
- `item/fileChange/outputDelta` — Reports the `item/fileChange/outputDelta` event. Payload: `FileChangeOutputDeltaNotification`: `delta`, `itemId`, `threadId`, `turnId`.
- `item/fileChange/patchUpdated` — Reports the `item/fileChange/patchUpdated` event. Payload: `FileChangePatchUpdatedNotification`: `changes`, `itemId`, `threadId`, `turnId`.
- `item/mcpToolCall/progress` — Reports the `item/mcpToolCall/progress` event. Payload: `McpToolCallProgressNotification`: `itemId`, `message`, `threadId`, `turnId`.
- `item/reasoning/summaryTextDelta` — Reports the `item/reasoning/summaryTextDelta` event. Payload: `ReasoningSummaryTextDeltaNotification`: `delta`, `itemId`, `summaryIndex`, `threadId`, `turnId`.
- `item/reasoning/summaryPartAdded` — Reports the `item/reasoning/summaryPartAdded` event. Payload: `ReasoningSummaryPartAddedNotification`: `itemId`, `summaryIndex`, `threadId`, `turnId`.
- `item/reasoning/textDelta` — Reports the `item/reasoning/textDelta` event. Payload: `ReasoningTextDeltaNotification`: `contentIndex`, `delta`, `itemId`, `threadId`, `turnId`.

### autoApprovalReview

- `autoApprovalReview/strictReviewRequired` — Reports the `autoApprovalReview/strictReviewRequired` event. Payload: `StrictReviewRequiredNotification`: `startedAtMs`, `threadId`, `turnId`.

### rawResponseItem

- `rawResponseItem/completed` — Reports the `rawResponseItem/completed` event. Payload: `RawResponseItemCompletedNotification`: `item`, `threadId`, `turnId`.

### rawResponse

- `rawResponse/completed` — Reports the `rawResponse/completed` event. Payload: `RawResponseCompletedNotification`: `responseId`, `threadId`, `turnId`, `usage?`, `usageMetadata?`.

### Sandboxed command

- `command/exec/outputDelta` — Reports the `command/exec/outputDelta` event. Payload: `CommandExecOutputDeltaNotification`: `capReached`, `deltaBase64`, `processId`, `stream`.

### Unsandboxed process

- `process/outputDelta` — Reports the `process/outputDelta` event. Payload: `ProcessOutputDeltaNotification`: `capReached`, `deltaBase64`, `processHandle`, `stream`.
- `process/exited` — Reports the `process/exited` event. Payload: `ProcessExitedNotification`: `exitCode`, `processHandle`, `stderr`, `stderrCapReached`, `stdout`, `stdoutCapReached`.

### serverRequest

- `serverRequest/resolved` — Reports the `serverRequest/resolved` event. Payload: `ServerRequestResolvedNotification`: `requestId`, `threadId`.

### MCP server

- `mcpServer/oauthLogin/completed` — Reports the `mcpServer/oauthLogin/completed` event. Payload: `McpServerOauthLoginCompletedNotification`: `error?`, `name`, `success`, `threadId?`.
- `mcpServer/startupStatus/updated` — Reports the `mcpServer/startupStatus/updated` event. Payload: `McpServerStatusUpdatedNotification`: `error?`, `failureReason?`, `name`, `status`, `threadId?`.
- `mcpServer/event/stream/notification` — Reports the `mcpServer/event/stream/notification` event. Payload: `McpServerEventStreamNotification`: `notification`, `subscriptionId`.

### Account

- `account/updated` — Reports the `account/updated` event. Payload: `AccountUpdatedNotification`: `authMode?`, `planType?`.
- `account/rateLimits/updated` — Reports the `account/rateLimits/updated` event. Payload: `AccountRateLimitsUpdatedNotification`: `rateLimits`.
- `account/login/completed` — Reports the `account/login/completed` event. Payload: `AccountLoginCompletedNotification`: `error?`, `loginId?`, `onboardingEntrypoint?`, `success`.

### Apps

- `app/list/updated` — Reports the `app/list/updated` event. Payload: `AppListUpdatedNotification`: `data`.

### Remote control

- `remoteControl/status/changed` — Reports the `remoteControl/status/changed` event. Payload: `RemoteControlStatusChangedNotification`: `environmentId?`, `installationId`, `serverName`, `status`.

### External agent configuration

- `externalAgentConfig/import/progress` — Reports the `externalAgentConfig/import/progress` event. Payload: `ExternalAgentConfigImportProgressNotification`: `importId`, `itemTypeResults`.
- `externalAgentConfig/import/completed` — Reports the `externalAgentConfig/import/completed` event. Payload: `ExternalAgentConfigImportCompletedNotification`: `importId`, `itemTypeResults`.

### Filesystem

- `fs/changed` — Reports the `fs/changed` event. Payload: `FsChangedNotification`: `changedPaths`, `watchId`.

### Models

- `model/rerouted` — Reports the `model/rerouted` event. Payload: `ModelReroutedNotification`: `fromModel`, `reason`, `threadId`, `toModel`, `turnId`.
- `model/verification` — Reports the `model/verification` event. Payload: `ModelVerificationNotification`: `threadId`, `turnId`, `verifications`.
- `model/safetyBuffering/updated` — Reports the `model/safetyBuffering/updated` event. Payload: `ModelSafetyBufferingUpdatedNotification`: `fasterModel?`, `model`, `reasons`, `showBufferingUi`, `threadId`, `turnId`, `useCases`.

### Model provider

- `modelProvider/authRecoveryStarted` — Reports the `modelProvider/authRecoveryStarted` event. Payload: `AuthRecoveryNotification`: `message`, `provider`, `threadId`, `turnId`.
- `modelProvider/authRecoveryCompleted` — Reports the `modelProvider/authRecoveryCompleted` event. Payload: `AuthRecoveryNotification`: `message`, `provider`, `threadId`, `turnId`.

### warning

- `warning` — Reports the `warning` event. Payload: `WarningNotification`: `message`, `threadId?`.

### guardianWarning

- `guardianWarning` — Reports the `guardianWarning` event. Payload: `GuardianWarningNotification`: `message`, `threadId`.

### deprecationNotice

- `deprecationNotice` — Reports the `deprecationNotice` event. Payload: `DeprecationNoticeNotification`: `details?`, `summary`.

### configWarning

- `configWarning` — Reports the `configWarning` event. Payload: `ConfigWarningNotification`: `details?`, `path?`, `range?`, `summary`.

### Fuzzy file search

- `fuzzyFileSearch/sessionUpdated` — Reports the `fuzzyFileSearch/sessionUpdated` event. Payload: `FuzzyFileSearchSessionUpdatedNotification`: `files`, `query`, `sessionId`.
- `fuzzyFileSearch/sessionCompleted` — Reports the `fuzzyFileSearch/sessionCompleted` event. Payload: `FuzzyFileSearchSessionCompletedNotification`: `sessionId`.

### Windows

- `windows/worldWritableWarning` — Reports the `windows/worldWritableWarning` event. Payload: `WindowsWorldWritableWarningNotification`: `extraCount`, `failedScan`, `samplePaths`.

### Windows sandbox

- `windowsSandbox/setupCompleted` — Reports the `windowsSandbox/setupCompleted` event. Payload: `WindowsSandboxSetupCompletedNotification`: `error?`, `mode`, `success`.

## Client notification (1)

- `initialized` — Sent after a successful `initialize` response to indicate that the client is ready. It has no `id`, `params`, or response.
