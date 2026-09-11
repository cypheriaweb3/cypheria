# Codex App Server API 参考

本文分析当前提交在 `packages/protocol/src/generated/codex` 下的自动生成协议，覆盖启用实验定义后生成的完整 API：158 个客户端请求、11 个服务端反向请求、83 个服务端通知，以及 1 个客户端通知。

Cypheria client protocol 通过 `agent.codex` 下机械生成的 dotted name 暴露这套完整 API。Slash separator 转为 dot，camel-case segment 转为 snake case，并以 `.request`、`.response` 或 `.notification` 明确消息方向。每种 dotted message 都有从 generated JSON Schema 派生的专用 Zod schema，并在静态类型上与对应 generated Codex TypeScript type 配对。这些 message contract 从 `@cypheria/protocol` 导出，原始 generated Codex type 则隔离在 `@cypheria/protocol/codex-types`。

协议采用 JSON-RPC 风格消息。客户端请求包含 `id`、`method` 和各方法专用的 `params`；服务端反向请求使用相同结构但方向相反；通知没有 `id`；成功响应包含 `id` 和 `result`；错误响应包含 `id` 和 `error`。下文顶层字段名后的 `?` 表示可选。字段列表前的生成类型名是嵌套结构和枚举值的最终依据。

## 客户端请求（158）

### 初始化

- `initialize` — 协商客户端能力并初始化连接。 入参: `InitializeParams`: `capabilities?`, `clientInfo`. 出参: `InitializeResponse`: `codexHome`, `platformFamily`, `platformOs`, `userAgent`.

### 服务器

- `server/diagnostics` — 读取不含内容数据的进程级诊断信息。 入参: `ServerDiagnosticsParams`: `{}`. 出参: `ServerDiagnosticsResponse`: `gauges`, `process`.

### 任务线程

- `thread/start` — 启动任务线程。 入参: `ThreadStartParams`: `allowProviderModelFallback?`, `approvalPolicy?`, `approvalsReviewer?`, `baseInstructions?`, `config?`, `cwd?`, `developerInstructions?`, `dynamicTools?`, `environments?`, `ephemeral?`, `experimentalRawEvents?`, `historyMode?`, `mockExperimentalField?`, `model?`, `modelProvider?`, `multiAgentMode?`, `permissions?`, `personality?`, `projectId?`, `runtimeWorkspaceRoots?`, `sandbox?`, `selectedCapabilityRoots?`, `serviceName?`, `serviceTier?`, `sessionStartSource?`, `threadSource?`. 出参: `ThreadStartResponse`: `activePermissionProfile?`, `approvalPolicy`, `approvalsReviewer`, `cwd`, `instructionSources?`, `model`, `modelProvider`, `multiAgentMode?`, `reasoningEffort?`, `runtimeWorkspaceRoots?`, `sandbox`, `serviceTier?`, `thread`.
- `thread/resume` — 恢复任务线程。 入参: `ThreadResumeParams`: `approvalPolicy?`, `approvalsReviewer?`, `baseInstructions?`, `config?`, `cwd?`, `developerInstructions?`, `excludeTurns?`, `history?`, `initialTurnsPage?`, `model?`, `modelProvider?`, `path?`, `permissions?`, `personality?`, `runtimeWorkspaceRoots?`, `sandbox?`, `serviceTier?`, `threadId`. 出参: `ThreadResumeResponse`: `activePermissionProfile?`, `approvalPolicy`, `approvalsReviewer`, `cwd`, `initialTurnsPage?`, `instructionSources?`, `itemsBackwardsCursor?`, `model`, `modelProvider`, `multiAgentMode?`, `reasoningEffort?`, `runtimeWorkspaceRoots?`, `sandbox`, `serviceTier?`, `thread`, `turnsBackwardsCursor?`.
- `thread/fork` — 分叉任务线程。 入参: `ThreadForkParams`: `approvalPolicy?`, `approvalsReviewer?`, `baseInstructions?`, `beforeTurnId?`, `config?`, `cwd?`, `deferGoalContinuation?`, `developerInstructions?`, `ephemeral?`, `excludeTurns?`, `lastTurnId?`, `model?`, `modelProvider?`, `path?`, `permissions?`, `runtimeWorkspaceRoots?`, `sandbox?`, `serviceTier?`, `threadId`, `threadSource?`. 出参: `ThreadForkResponse`: `activePermissionProfile?`, `approvalPolicy`, `approvalsReviewer`, `cwd`, `instructionSources?`, `model`, `modelProvider`, `multiAgentMode?`, `reasoningEffort?`, `runtimeWorkspaceRoots?`, `sandbox`, `serviceTier?`, `thread`.
- `thread/archive` — 归档任务线程。 入参: `ThreadArchiveParams`: `threadId`. 出参: `ThreadArchiveResponse`: `{}`.
- `thread/delete` — 删除任务线程。 入参: `ThreadDeleteParams`: `threadId`. 出参: `ThreadDeleteResponse`: `{}`.
- `thread/unsubscribe` — 取消订阅任务线程。 入参: `ThreadUnsubscribeParams`: `threadId`. 出参: `ThreadUnsubscribeResponse`: `status`.
- `thread/increment_elicitation` — 增加外部交互计数任务线程。 入参: `ThreadIncrementElicitationParams`: `threadId`. 出参: `ThreadIncrementElicitationResponse`: `count`, `paused`.
- `thread/decrement_elicitation` — 减少外部交互计数任务线程。 入参: `ThreadDecrementElicitationParams`: `threadId`. 出参: `ThreadDecrementElicitationResponse`: `count`, `paused`.
- `thread/name/set` — 设置任务线程的 name。 入参: `ThreadSetNameParams`: `name`, `threadId`. 出参: `ThreadSetNameResponse`: `{}`.
- `thread/goal/set` — 设置任务线程的 goal。 入参: `ThreadGoalSetParams`: `objective?`, `status?`, `threadId`, `tokenBudget?`. 出参: `ThreadGoalSetResponse`: `goal`.
- `thread/goal/get` — 读取任务线程的 goal。 入参: `ThreadGoalGetParams`: `threadId`. 出参: `ThreadGoalGetResponse`: `goal?`.
- `thread/goal/clear` — 清除任务线程的 goal。 入参: `ThreadGoalClearParams`: `threadId`. 出参: `ThreadGoalClearResponse`: `cleared`.
- `thread/queue/add` — 添加任务线程的 queue。 入参: `ThreadQueueAddParams`: `clientUserMessageId`, `input`, `threadId`. 出参: `ThreadQueueAddResponse`: `queuedSubmission`.
- `thread/queue/list` — 列出任务线程的 queue。 入参: `ThreadQueueListParams`: `cursor?`, `limit?`, `threadId`. 出参: `ThreadQueueListResponse`: `data`, `nextCursor?`.
- `thread/queue/update` — 更新任务线程的 queue。 入参: `ThreadQueueUpdateParams`: `input`, `queuedSubmissionId`, `threadId`. 出参: `ThreadQueueUpdateResponse`: `queuedSubmission`.
- `thread/queue/delete` — 删除任务线程的 queue。 入参: `ThreadQueueDeleteParams`: `queuedSubmissionId`, `threadId`. 出参: `ThreadQueueDeleteResponse`: `deleted`.
- `thread/queue/reorder` — 重排任务线程的 queue。 入参: `ThreadQueueReorderParams`: `queuedSubmissionIds`, `threadId`. 出参: `ThreadQueueReorderResponse`: `{}`.
- `thread/queue/start` — 启动任务线程的 queue。 入参: `ThreadQueueStartParams`: `queuedSubmissionId?`, `threadId`. 出参: `ThreadQueueStartResponse`: `turn`.
- `thread/metadata/update` — 更新任务线程的 metadata。 入参: `ThreadMetadataUpdateParams`: `gitInfo?`, `projectId?`, `threadId`. 出参: `ThreadMetadataUpdateResponse`: `thread`.
- `thread/section/move` — 移动任务线程的 section。 入参: `ThreadSectionMoveParams`: `beforeThreadId?`, `sectionId`, `threadId`. 出参: `ThreadSectionMoveResponse`: `{}`.
- `thread/settings/update` — 更新任务线程的 settings。 入参: `ThreadSettingsUpdateParams`: `approvalPolicy?`, `approvalsReviewer?`, `collaborationMode?`, `cwd?`, `effort?`, `model?`, `multiAgentMode?`, `permissions?`, `personality?`, `sandboxPolicy?`, `serviceTier?`, `summary?`, `threadId`. 出参: `ThreadSettingsUpdateResponse`: `{}`.
- `thread/memoryMode/set` — 设置任务线程的 memoryMode。 入参: `ThreadMemoryModeSetParams`: `mode`, `threadId`. 出参: `ThreadMemoryModeSetResponse`: `{}`.
- `thread/unarchive` — 取消归档任务线程。 入参: `ThreadUnarchiveParams`: `threadId`. 出参: `ThreadUnarchiveResponse`: `thread`.
- `thread/compact/start` — 启动任务线程的 compact。 入参: `ThreadCompactStartParams`: `threadId`. 出参: `ThreadCompactStartResponse`: `{}`.
- `thread/shellCommand` — 执行线程 Shell 命令任务线程。 入参: `ThreadShellCommandParams`: `command`, `threadId`, `timeoutMs?`. 出参: `ThreadShellCommandResponse`: `{}`.
- `thread/approveGuardianDeniedAction` — 批准此前被 Guardian 拒绝的动作。 入参: `ThreadApproveGuardianDeniedActionParams`: `event`, `threadId`. 出参: `ThreadApproveGuardianDeniedActionResponse`: `{}`.
- `thread/backgroundTerminals/clean` — 清理任务线程的 backgroundTerminals。 入参: `ThreadBackgroundTerminalsCleanParams`: `threadId`. 出参: `ThreadBackgroundTerminalsCleanResponse`: `{}`.
- `thread/backgroundTerminals/list` — 列出任务线程的 backgroundTerminals。 入参: `ThreadBackgroundTerminalsListParams`: `cursor?`, `limit?`, `threadId`. 出参: `ThreadBackgroundTerminalsListResponse`: `data`, `nextCursor?`.
- `thread/backgroundTerminals/terminate` — 终止任务线程的 backgroundTerminals。 入参: `ThreadBackgroundTerminalsTerminateParams`: `processId`, `threadId`. 出参: `ThreadBackgroundTerminalsTerminateResponse`: `terminated`.
- `thread/rollback` — 回滚任务线程。 入参: `ThreadRollbackParams`: `numTurns`, `threadId`. 出参: `ThreadRollbackResponse`: `thread`.
- `thread/revert` — 还原任务线程。 入参: `ThreadRevertParams`: `beforeTurnId`, `threadId`. 出参: `ThreadRevertResponse`: `itemsBackwardsCursor?`, `thread`, `turnsBackwardsCursor?`.
- `thread/list` — 列出任务线程。 入参: `ThreadListParams`: `ancestorThreadId?`, `archived?`, `cursor?`, `cwd?`, `limit?`, `modelProviders?`, `parentThreadId?`, `projectId?`, `searchTerm?`, `sectionId?`, `sortDirection?`, `sortKey?`, `sourceKinds?`, `useStateDbOnly?`. 出参: `ThreadListResponse`: `backwardsCursor?`, `data`, `nextCursor?`.
- `thread/search` — 搜索任务线程。 入参: `ThreadSearchParams`: `archived?`, `cursor?`, `limit?`, `searchTerm`, `sortDirection?`, `sortKey?`, `sourceKinds?`. 出参: `ThreadSearchResponse`: `backwardsCursor?`, `data`, `nextCursor?`.
- `thread/searchOccurrences` — 搜索出现位置任务线程。 入参: `ThreadSearchOccurrencesParams`: `cursor?`, `limit?`, `searchTerm`, `threadId`. 出参: `ThreadSearchOccurrencesResponse`: `data`, `nextCursor?`.
- `thread/loaded/list` — 列出任务线程的 loaded。 入参: `ThreadLoadedListParams`: `cursor?`, `limit?`. 出参: `ThreadLoadedListResponse`: `data`, `nextCursor?`.
- `thread/read` — 读取任务线程。 入参: `ThreadReadParams`: `includeTurns?`, `threadId`. 出参: `ThreadReadResponse`: `thread`.
- `thread/turns/list` — 列出任务线程的 turns。 入参: `ThreadTurnsListParams`: `cursor?`, `itemsView?`, `limit?`, `sortDirection?`, `threadId`. 出参: `ThreadTurnsListResponse`: `backwardsCursor?`, `data`, `nextCursor?`.
- `thread/items/list` — 列出任务线程的 items。 入参: `ThreadItemsListParams`: `cursor?`, `limit?`, `sortDirection?`, `threadId`, `turnId?`. 出参: `ThreadItemsListResponse`: `backwardsCursor?`, `data`, `nextCursor?`.
- `thread/inject_items` — 注入历史条目到任务线程。 入参: `ThreadInjectItemsParams`: `items`, `threadId`. 出参: `ThreadInjectItemsResponse`: `{}`.
- `thread/realtime/start` — 启动任务线程的 realtime。 入参: `ThreadRealtimeStartParams`: `clientManagedHandoffs?`, `codexResponseHandoffChannelPrefixes?`, `codexResponseHandoffMode?`, `codexResponseItemPrefix?`, `codexResponsesAsItems?`, `delegationAckFiller?`, `flushTranscriptTailOnSessionEnd?`, `includeStartupContext?`, `initialItems?`, `model?`, `outputModality`, `prompt?`, `realtimeEndInstructions?`, `realtimeSessionId?`, `realtimeStartInstructions?`, `threadId`, `transport?`, `version?`, `voice?`. 出参: `ThreadRealtimeStartResponse`: `{}`.
- `thread/realtime/appendAudio` — 追加音频到任务线程的 realtime。 入参: `ThreadRealtimeAppendAudioParams`: `audio`, `threadId`. 出参: `ThreadRealtimeAppendAudioResponse`: `{}`.
- `thread/realtime/appendText` — 追加文本到任务线程的 realtime。 入参: `ThreadRealtimeAppendTextParams`: `role?`, `text`, `threadId`. 出参: `ThreadRealtimeAppendTextResponse`: `{}`.
- `thread/realtime/appendSpeech` — 追加语音文本到任务线程的 realtime。 入参: `ThreadRealtimeAppendSpeechParams`: `text`, `threadId`. 出参: `ThreadRealtimeAppendSpeechResponse`: `{}`.
- `thread/realtime/stop` — 停止任务线程的 realtime。 入参: `ThreadRealtimeStopParams`: `threadId`. 出参: `ThreadRealtimeStopResponse`: `{}`.
- `thread/timeline/list` — 列出任务线程的 timeline。 入参: `ThreadTimelineListParams`: `cursor?`, `limit?`, `threadId`. 出参: `ThreadTimelineListResponse`: `activeRealtimeSessionAtPageStart?`, `data`, `nextCursor?`.
- `thread/realtime/listVoices` — 列出语音任务线程的 realtime。 入参: `ThreadRealtimeListVoicesParams`: `{}`. 出参: `ThreadRealtimeListVoicesResponse`: `voices`.

### 记忆

- `memory/reset` — 重置记忆。 入参: `undefined`（省略 `params`）. 出参: `MemoryResetResponse`: `{}`.

### 项目

- `project/list` — 列出项目。 入参: `ProjectListParams`: `cursor?`, `limit?`, `sortDirection?`, `sortKey?`. 出参: `ProjectListResponse`: `data`, `nextCursor?`.
- `project/read` — 读取项目。 入参: `ProjectReadParams`: `projectId`. 出参: `ProjectReadResponse`: `project`.
- `project/create` — 创建项目。 入参: `ProjectCreateParams`: `idempotencyKey`, `metadata?`, `name`, `roots`. 出参: `ProjectCreateResponse`: `project`.
- `project/import` — 导入项目。 入参: `ProjectImportParams`: `idempotencyKey`, `metadata?`, `name`, `roots`, `threads?`. 出参: `ProjectImportResponse`: `project`.
- `project/update` — 更新项目。 入参: `ProjectUpdateParams`: `metadata?`, `name?`, `projectId`, `roots?`. 出参: `ProjectUpdateResponse`: `project`.
- `project/move` — 移动项目。 入参: `ProjectMoveParams`: `beforeProjectId?`, `projectId`. 出参: `ProjectMoveResponse`: `{}`.
- `project/delete` — 删除项目。 入参: `ProjectDeleteParams`: `projectId`. 出参: `ProjectDeleteResponse`: `{}`.

### 任务分区

- `threadSection/list` — 列出任务分区。 入参: `ThreadSectionListParams`: `cursor?`, `limit?`. 出参: `ThreadSectionListResponse`: `data`, `nextCursor?`.
- `threadSection/create` — 创建任务分区。 入参: `ThreadSectionCreateParams`: `appearance?`, `name`. 出参: `ThreadSectionCreateResponse`: `section`.
- `threadSection/update` — 更新任务分区。 入参: `ThreadSectionUpdateParams`: `appearance?`, `name`, `sectionId`. 出参: `ThreadSectionUpdateResponse`: `section`.
- `threadSection/delete` — 删除任务分区。 入参: `ThreadSectionDeleteParams`: `sectionId`. 出参: `ThreadSectionDeleteResponse`: `{}`.

### 技能

- `skills/list` — 列出技能。 入参: `SkillsListParams`: `cwds?`, `forceReload?`. 出参: `SkillsListResponse`: `data`.
- `skills/extraRoots/set` — 设置技能的 extraRoots。 入参: `SkillsExtraRootsSetParams`: `extraRoots`. 出参: `SkillsExtraRootsSetResponse`: `{}`.
- `skills/config/write` — 写入技能的 config。 入参: `SkillsConfigWriteParams`: `enabled`, `name?`, `path?`. 出参: `SkillsConfigWriteResponse`: `effectiveEnabled`.

### Hook

- `hooks/list` — 列出Hook。 入参: `HooksListParams`: `cwds?`. 出参: `HooksListResponse`: `data`.

### 市场源

- `marketplace/add` — 添加市场源。 入参: `MarketplaceAddParams`: `refName?`, `source`, `sparsePaths?`. 出参: `MarketplaceAddResponse`: `alreadyAdded`, `installedRoot`, `marketplaceName`.
- `marketplace/remove` — 移除市场源。 入参: `MarketplaceRemoveParams`: `marketplaceName`. 出参: `MarketplaceRemoveResponse`: `installedRoot?`, `marketplaceName`.
- `marketplace/upgrade` — 升级市场源。 入参: `MarketplaceUpgradeParams`: `marketplaceName?`. 出参: `MarketplaceUpgradeResponse`: `errors`, `selectedMarketplaces`, `upgradedRoots`.

### 插件

- `plugin/list` — 列出插件。 入参: `PluginListParams`: `cwds?`, `forceRefetch?`, `marketplaceKinds?`. 出参: `PluginListResponse`: `featuredPluginIds?`, `marketplaceLoadErrors?`, `marketplaces`.
- `plugin/search` — 搜索插件。 入参: `PluginSearchParams`: `cursor?`, `cwds?`, `limit?`, `scope?`, `searchTerm`. 出参: `PluginSearchResponse`: `data`, `nextCursor?`.
- `plugin/installed` — 列出已安装项插件。 入参: `PluginInstalledParams`: `cwds?`, `installSuggestionPluginNames?`. 出参: `PluginInstalledResponse`: `marketplaceLoadErrors?`, `marketplaces`.
- `plugin/reconcile` — 对账并修复插件。 入参: `PluginReconcileParams`: `reason?`. 出参: `PluginReconcileResponse`: `changedPlugins`, `failedMaterializationRemotePluginIds`, `failedRemotePluginIds`.
- `plugin/read` — 读取插件。 入参: `PluginReadParams`: `marketplacePath?`, `pluginName`, `remoteMarketplaceName?`. 出参: `PluginReadResponse`: `plugin`.
- `plugin/skill/read` — 读取插件的 skill。 入参: `PluginSkillReadParams`: `remoteMarketplaceName`, `remotePluginId`, `skillName`. 出参: `PluginSkillReadResponse`: `contents?`.
- `plugin/share/save` — 保存插件的 share。 入参: `PluginShareSaveParams`: `discoverability?`, `pluginPath`, `remotePluginId?`, `shareTargets?`. 出参: `PluginShareSaveResponse`: `canPublishToWorkspace?`, `remotePluginId`, `shareUrl`.
- `plugin/share/updateTargets` — 更新共享目标插件的 share。 入参: `PluginShareUpdateTargetsParams`: `discoverability`, `remotePluginId`, `shareTargets`. 出参: `PluginShareUpdateTargetsResponse`: `discoverability`, `principals`.
- `plugin/share/list` — 列出插件的 share。 入参: `PluginShareListParams`: `{}`. 出参: `PluginShareListResponse`: `data`.
- `plugin/share/checkout` — 检出插件的 share。 入参: `PluginShareCheckoutParams`: `remotePluginId`. 出参: `PluginShareCheckoutResponse`: `marketplaceName`, `marketplacePath`, `pluginId`, `pluginName`, `pluginPath`, `remotePluginId`, `remoteVersion?`.
- `plugin/share/delete` — 删除插件的 share。 入参: `PluginShareDeleteParams`: `remotePluginId`. 出参: `PluginShareDeleteResponse`: `{}`.
- `plugin/install` — 安装插件。 入参: `PluginInstallParams`: `installAttemptId?`, `marketplacePath?`, `pluginName`, `remoteMarketplaceName?`. 出参: `PluginInstallResponse`: `appsNeedingAuth`, `authPolicy`.
- `plugin/uninstall` — 卸载插件。 入参: `PluginUninstallParams`: `pluginId`. 出参: `PluginUninstallResponse`: `{}`.

### 应用

- `app/read` — 读取应用。 入参: `AppsReadParams`: `appIds`, `includeTools?`, `threadId?`. 出参: `AppsReadResponse`: `apps`, `missingAppIds`.
- `app/list` — 列出应用。 入参: `AppsListParams`: `cursor?`, `forceRefetch?`, `limit?`, `threadId?`. 出参: `AppsListResponse`: `data`, `nextCursor?`.
- `app/installed` — 列出已安装项应用。 入参: `AppsInstalledParams`: `forceRefresh?`, `threadId?`. 出参: `AppsInstalledResponse`: `apps`.

### 文件系统

- `fs/readFile` — 读取文件文件系统。 入参: `FsReadFileParams`: `path`. 出参: `FsReadFileResponse`: `dataBase64`.
- `fs/writeFile` — 写入文件文件系统。 入参: `FsWriteFileParams`: `dataBase64`, `path`. 出参: `FsWriteFileResponse`: `{}`.
- `fs/createDirectory` — 创建目录文件系统。 入参: `FsCreateDirectoryParams`: `path`, `recursive?`. 出参: `FsCreateDirectoryResponse`: `{}`.
- `fs/getMetadata` — 读取元数据文件系统。 入参: `FsGetMetadataParams`: `path`. 出参: `FsGetMetadataResponse`: `createdAtMs`, `isDirectory`, `isFile`, `isSymlink`, `modifiedAtMs`.
- `fs/readDirectory` — 读取目录文件系统。 入参: `FsReadDirectoryParams`: `path`. 出参: `FsReadDirectoryResponse`: `entries`.
- `fs/remove` — 移除文件系统。 入参: `FsRemoveParams`: `force?`, `path`, `recursive?`. 出参: `FsRemoveResponse`: `{}`.
- `fs/copy` — 复制文件系统。 入参: `FsCopyParams`: `destinationPath`, `recursive?`, `sourcePath`. 出参: `FsCopyResponse`: `{}`.
- `fs/watch` — 监听文件系统。 入参: `FsWatchParams`: `path`, `watchId`. 出参: `FsWatchResponse`: `path`.
- `fs/unwatch` — 停止监听文件系统。 入参: `FsUnwatchParams`: `watchId`. 出参: `FsUnwatchResponse`: `{}`.

### 轮次

- `turn/start` — 启动轮次。 入参: `TurnStartParams`: `additionalContext?`, `approvalPolicy?`, `approvalsReviewer?`, `clientUserMessageId?`, `collaborationMode?`, `cwd?`, `cyberAccessProgram?`, `effort?`, `environments?`, `input`, `model?`, `multiAgentMode?`, `outputSchema?`, `permissions?`, `personality?`, `responsesapiClientMetadata?`, `runtimeWorkspaceRoots?`, `sandboxPolicy?`, `serviceTier?`, `serviceTierForTurn?`, `summary?`, `threadId`, `toolOutput?`, `turnTrigger?`. 出参: `TurnStartResponse`: `turn`.
- `turn/settings/update` — 更新轮次的 settings。 入参: `TurnSettingsUpdateParams`: `approvalsReviewer?`, `effort?`, `model?`, `serviceTier?`, `summary?`, `threadId`, `turnId`. 出参: `TurnSettingsUpdateResponse`: `status`.
- `turn/steer` — 引导轮次。 入参: `TurnSteerParams`: `additionalContext?`, `clientUserMessageId?`, `expectedTurnId`, `input`, `responsesapiClientMetadata?`, `threadId`. 出参: `TurnSteerResponse`: `turnId`.
- `turn/interrupt` — 中断轮次。 入参: `TurnInterruptParams`: `threadId`, `turnId`. 出参: `TurnInterruptResponse`: `{}`.

### 审查

- `review/start` — 启动审查。 入参: `ReviewStartParams`: `delivery?`, `target`, `threadId`. 出参: `ReviewStartResponse`: `reviewThreadId`, `turn`.

### 模型

- `model/list` — 列出模型。 入参: `ModelListParams`: `cursor?`, `includeHidden?`, `limit?`. 出参: `ModelListResponse`: `data`, `nextCursor?`.

### 模型提供方

- `modelProvider/capabilities/read` — 读取模型提供方的 capabilities。 入参: `ModelProviderCapabilitiesReadParams`: `{}`. 出参: `ModelProviderCapabilitiesReadResponse`: `imageGeneration`, `namespaceTools`, `webSearch`.

### 实验功能

- `experimentalFeature/list` — 列出实验功能。 入参: `ExperimentalFeatureListParams`: `cursor?`, `limit?`, `threadId?`. 出参: `ExperimentalFeatureListResponse`: `data`, `nextCursor?`.
- `experimentalFeature/enablement/set` — 设置实验功能的 enablement。 入参: `ExperimentalFeatureEnablementSetParams`: `enablement`. 出参: `ExperimentalFeatureEnablementSetResponse`: `enablement`.

### 权限配置

- `permissionProfile/list` — 列出权限配置。 入参: `PermissionProfileListParams`: `cursor?`, `cwd?`, `limit?`. 出参: `PermissionProfileListResponse`: `data`, `nextCursor?`.

### 远程控制

- `remoteControl/enable` — 启用远程控制。 入参: `RemoteControlEnableParams | null`. 出参: `RemoteControlEnableResponse`: `environmentId?`, `installationId`, `serverName`, `status`.
- `remoteControl/disable` — 禁用远程控制。 入参: `RemoteControlDisableParams | null`. 出参: `RemoteControlDisableResponse`: `environmentId?`, `installationId`, `serverName`, `status`.
- `remoteControl/status/read` — 读取远程控制的 status。 入参: `undefined`（省略 `params`）. 出参: `RemoteControlStatusReadResponse`: `environmentId?`, `installationId`, `serverName`, `status`.
- `remoteControl/pairing/start` — 启动远程控制的 pairing。 入参: `RemoteControlPairingStartParams`: `manualCode?`. 出参: `RemoteControlPairingStartResponse`: `environmentId`, `expiresAt`, `manualPairingCode?`, `pairingCode`.
- `remoteControl/pairing/status` — 读取状态远程控制的 pairing。 入参: `RemoteControlPairingStatusParams`: `manualPairingCode?`, `pairingCode?`. 出参: `RemoteControlPairingStatusResponse`: `claimed`.
- `remoteControl/client/list` — 列出远程控制的 client。 入参: `RemoteControlClientsListParams`: `cursor?`, `environmentId`, `limit?`, `order?`. 出参: `RemoteControlClientsListResponse`: `data`, `nextCursor?`.
- `remoteControl/client/revoke` — 撤销授权远程控制的 client。 入参: `RemoteControlClientsRevokeParams`: `clientId`, `environmentId`. 出参: `RemoteControlClientsRevokeResponse`: `{}`.

### 协作模式

- `collaborationMode/list` — 列出协作模式。 入参: `CollaborationModeListParams`: `{}`. 出参: `CollaborationModeListResponse`: `data`.

### mock

- `mock/experimentalMethod` — 执行 mock/experimentalMethod。 入参: `MockExperimentalMethodParams`: `value?`. 出参: `MockExperimentalMethodResponse`: `echoed?`.

### 执行环境

- `environment/add` — 添加执行环境。 入参: `EnvironmentAddParams`: `connectTimeoutMs?`, `environmentId`, `execServerUrl`. 出参: `EnvironmentAddResponse`: `{}`.
- `environment/info` — 读取信息执行环境。 入参: `EnvironmentInfoParams`: `environmentId`. 出参: `EnvironmentInfoResponse`: `cwd?`, `shell`.
- `environment/status` — 读取状态执行环境。 入参: `EnvironmentStatusParams`: `environmentId`. 出参: `EnvironmentStatusResponse`: `error?`, `status`.

### MCP Server

- `mcpServer/oauth/login` — 开始登录MCP Server的 oauth。 入参: `McpServerOauthLoginParams`: `clientRegistration?`, `name`, `scopes?`, `threadId?`, `timeoutSecs?`. 出参: `McpServerOauthLoginResponse`: `authorizationUrl`.
- `mcpServer/resource/read` — 读取MCP Server的 resource。 入参: `McpResourceReadParams`: `connectorId?`, `originCallId?`, `server`, `threadId?`, `uri`. 出参: `McpResourceReadResponse`: `contents`, `originCallId?`.
- `mcpServer/event/stream/start` — 启动MCP Server的 event/stream。 入参: `McpServerEventStreamStartParams`: `_meta?`, `arguments`, `name`, `server`, `subscriptionId`, `threadId`. 出参: `McpServerEventStreamStartResponse`: `{}`.
- `mcpServer/event/stream/stop` — 停止MCP Server的 event/stream。 入参: `McpServerEventStreamStopParams`: `subscriptionId`. 出参: `McpServerEventStreamStopResponse`: `{}`.
- `mcpServer/tool/call` — 执行 mcpServer/tool/call。 入参: `McpServerToolCallParams`: `_meta?`, `arguments?`, `server`, `threadId`, `tool`. 出参: `McpServerToolCallResponse`: `_meta?`, `content`, `isError?`, `structuredContent?`.

### 配置

- `config/mcpServer/reload` — 重新加载配置的 mcpServer。 入参: `undefined`（省略 `params`）. 出参: `McpServerRefreshResponse`: `{}`.
- `config/read` — 读取配置。 入参: `ConfigReadParams`: `cwd?`, `includeLayers?`. 出参: `ConfigReadResponse`: `config`, `layers?`, `origins`.
- `config/value/write` — 写入配置的 value。 入参: `ConfigValueWriteParams`: `expectedVersion?`, `filePath?`, `keyPath`, `mergeStrategy`, `value`. 出参: `ConfigWriteResponse`: `filePath`, `overriddenMetadata?`, `status`, `version`.
- `config/batchWrite` — 执行 config/batchWrite。 入参: `ConfigBatchWriteParams`: `edits`, `expectedVersion?`, `filePath?`, `reloadUserConfig?`. 出参: `ConfigWriteResponse`: `filePath`, `overriddenMetadata?`, `status`, `version`.

### mcpServerStatus

- `mcpServerStatus/list` — 列出mcpServerStatus。 入参: `ListMcpServerStatusParams`: `cursor?`, `detail?`, `limit?`, `threadId?`. 出参: `ListMcpServerStatusResponse`: `data`, `nextCursor?`.

### Windows 沙箱

- `windowsSandbox/setupStart` — 开始配置Windows 沙箱。 入参: `WindowsSandboxSetupStartParams`: `cwd?`, `mode`. 出参: `WindowsSandboxSetupStartResponse`: `started`.
- `windowsSandbox/readiness` — 读取就绪状态Windows 沙箱。 入参: `undefined`（省略 `params`）. 出参: `WindowsSandboxReadinessResponse`: `status`.

### 账户

- `account/login/start` — 启动 API key、ChatGPT 或外部令牌登录流程。 入参: `LoginAccountParams`: `apiKey`, `type`, `appBrand?`, `codexStreamlinedLogin?`, `useHostedLoginSuccessPage?`, `accessToken`, `chatgptAccountId`, `chatgptPlanType?`, `region`, `accessKeyId`, `secretAccessKey`, `sessionToken?`. 出参: `LoginAccountResponse`: `type`, `authUrl`, `loginId`, `userCode`, `verificationUrl`.
- `account/bedrock/discover` — 发现账户的 bedrock。 入参: `BedrockDiscoverParams`: `{}`. 出参: `BedrockDiscoverResponse`: `environmentCredentials`, `profiles`.
- `account/bedrock/setup` — 配置账户的 bedrock。 入参: `BedrockSetupParams`: `profile`, `region`, `type`. 出参: `BedrockSetupResponse`: `{}`.
- `account/login/cancel` — 取消账户的 login。 入参: `CancelLoginAccountParams`: `loginId`. 出参: `CancelLoginAccountResponse`: `status`.
- `account/logout` — 执行 account/logout。 入参: `undefined`（省略 `params`）. 出参: `LogoutAccountResponse`: `{}`.
- `account/rateLimits/read` — 读取账户的 rateLimits。 入参: `undefined`（省略 `params`）. 出参: `GetAccountRateLimitsResponse`: `accountId?`, `rateLimitResetCredits?`, `rateLimitUpsell?`, `rateLimits`, `rateLimitsByLimitId?`.
- `account/rateLimitResetCredit/consume` — 消费账户的 rateLimitResetCredit。 入参: `ConsumeAccountRateLimitResetCreditParams`: `creditId?`, `idempotencyKey`. 出参: `ConsumeAccountRateLimitResetCreditResponse`: `outcome`.
- `account/usage/read` — 读取账户的 usage。 入参: `GetAccountTokenUsageParams`: `threadId?`；`params` 本身可省略. 出参: `GetAccountTokenUsageResponse`: `dailyUsageBuckets?`, `summary`, `threadUsage?`.
- `account/workspaceMessages/read` — 读取账户的 workspaceMessages。 入参: `undefined`（省略 `params`）. 出参: `GetWorkspaceMessagesResponse`: `featureEnabled`, `messages`.
- `account/sendAddCreditsNudgeEmail` — 发送充值提示邮件账户。 入参: `SendAddCreditsNudgeEmailParams`: `creditType`. 出参: `SendAddCreditsNudgeEmailResponse`: `status`.
- `account/read` — 读取账户。 入参: `GetAccountParams`: `refreshToken?`. 出参: `GetAccountResponse`: `account?`, `requiresOpenaiAuth`.

### 反馈

- `feedback/upload` — 执行 feedback/upload。 入参: `FeedbackUploadParams`: `classification`, `extraLogFiles?`, `includeLogs?`, `reason?`, `tags?`, `threadId?`. 出参: `FeedbackUploadResponse`: `threadId`.

### 沙箱命令

- `command/exec` — 执行 command/exec。 入参: `CommandExecParams`: `command`, `cwd?`, `disableOutputCap?`, `disableTimeout?`, `env?`, `outputBytesCap?`, `permissionProfile?`, `processId?`, `sandboxPolicy?`, `size?`, `streamStdin?`, `streamStdoutStderr?`, `timeoutMs?`, `tty?`. 出参: `CommandExecResponse`: `exitCode`, `stderr`, `stdout`.
- `command/exec/write` — 写入沙箱命令的 exec。 入参: `CommandExecWriteParams`: `closeStdin?`, `deltaBase64?`, `processId`. 出参: `CommandExecWriteResponse`: `{}`.
- `command/exec/terminate` — 终止沙箱命令的 exec。 入参: `CommandExecTerminateParams`: `processId`. 出参: `CommandExecTerminateResponse`: `{}`.
- `command/exec/resize` — 调整尺寸沙箱命令的 exec。 入参: `CommandExecResizeParams`: `processId`, `size`. 出参: `CommandExecResizeResponse`: `{}`.

### 非沙箱进程

- `process/spawn` — 启动进程非沙箱进程。 入参: `ProcessSpawnParams`: `command`, `cwd`, `env?`, `outputBytesCap?`, `processHandle`, `size?`, `streamStdin?`, `streamStdoutStderr?`, `timeoutMs?`, `tty?`. 出参: `ProcessSpawnResponse`: `{}`.
- `process/writeStdin` — 写入标准输入非沙箱进程。 入参: `ProcessWriteStdinParams`: `closeStdin?`, `deltaBase64?`, `processHandle`. 出参: `ProcessWriteStdinResponse`: `{}`.
- `process/kill` — 终止非沙箱进程。 入参: `ProcessKillParams`: `processHandle`. 出参: `ProcessKillResponse`: `{}`.
- `process/resizePty` — 调整 PTY 尺寸非沙箱进程。 入参: `ProcessResizePtyParams`: `processHandle`, `size`. 出参: `ProcessResizePtyResponse`: `{}`.

### 外部 Agent 配置

- `externalAgentConfig/detect` — 检测外部 Agent 配置。 入参: `ExternalAgentConfigDetectParams`: `cwds?`, `includeHome?`, `maxSessionAgeDays?`, `maxSessions?`, `migrationSource?`, `source?`. 出参: `ExternalAgentConfigDetectResponse`: `connectors?`, `items`.
- `externalAgentConfig/import` — 导入外部 Agent 配置。 入参: `ExternalAgentConfigImportParams`: `migrationItems`, `migrationSource?`, `providerId?`, `source?`. 出参: `ExternalAgentConfigImportResponse`: `importId`.
- `externalAgentConfig/import/recordHistory` — 记录导入历史外部 Agent 配置的 import。 入参: `ExternalAgentConfigImportHistoryRecordParams`: `itemTypeResults`, `providerId`. 出参: `ExternalAgentConfigImportHistoryRecordResponse`: `importId`.
- `externalAgentConfig/import/readHistories` — 读取导入历史外部 Agent 配置的 import。 入参: `undefined`（省略 `params`）. 出参: `ExternalAgentConfigImportHistoriesReadResponse`: `connectors`, `data`.

### 配置要求

- `configRequirements/read` — 读取配置要求。 入参: `undefined`（省略 `params`）. 出参: `ConfigRequirementsReadResponse`: `requirements?`.

### 旧版辅助 API

- `getConversationSummary` — 按 rollout 路径或会话 ID 读取旧版会话摘要。 入参: `GetConversationSummaryParams`: `rolloutPath | conversationId`. 出参: `GetConversationSummaryResponse`: `summary`.
- `gitDiffToRemote` — 计算工作树相对远端基线的 Git diff。 入参: `GitDiffToRemoteParams`: `cwd`. 出参: `GitDiffToRemoteResponse`: `sha`, `diff`.
- `getAuthStatus` — 读取旧版认证状态，并可选择返回或刷新令牌。 入参: `GetAuthStatusParams`: `includeToken?`, `refreshToken?`. 出参: `GetAuthStatusResponse`: `authMethod?`, `authToken?`, `requiresOpenaiAuth?`.

### 模糊文件搜索

- `fuzzyFileSearch` — 执行 fuzzyFileSearch。 入参: `FuzzyFileSearchParams`: `cancellationToken?`, `query`, `roots`. 出参: `FuzzyFileSearchResponse`: `files`.
- `fuzzyFileSearch/sessionStart` — 启动会话模糊文件搜索。 入参: `FuzzyFileSearchSessionStartParams`: `roots`, `sessionId`. 出参: `FuzzyFileSearchSessionStartResponse`: `{}`.
- `fuzzyFileSearch/sessionUpdate` — 更新会话模糊文件搜索。 入参: `FuzzyFileSearchSessionUpdateParams`: `query`, `sessionId`. 出参: `FuzzyFileSearchSessionUpdateResponse`: `{}`.
- `fuzzyFileSearch/sessionStop` — 停止会话模糊文件搜索。 入参: `FuzzyFileSearchSessionStopParams`: `sessionId`. 出参: `FuzzyFileSearchSessionStopResponse`: `{}`.

## 服务端反向请求（11）

这些是反向 RPC；客户端必须返回列出的响应，不能把它们当作普通通知。

### item

- `item/commandExecution/requestApproval` — 请求客户端批准命令执行。 入参: `CommandExecutionRequestApprovalParams`: `additionalPermissions?`, `approvalId?`, `availableDecisions?`, `command?`, `commandActions?`, `cwd?`, `environmentId?`, `itemId`, `kind?`, `networkApprovalContext?`, `proposedExecpolicyAmendment?`, `proposedNetworkPolicyAmendments?`, `reason?`, `startedAtMs`, `threadId`, `turnId`. 出参: `CommandExecutionRequestApprovalResponse`: `decision`.
- `item/fileChange/requestApproval` — 请求客户端批准文件改动。 入参: `FileChangeRequestApprovalParams`: `grantRoot?`, `itemId`, `reason?`, `startedAtMs`, `threadId`, `turnId`. 出参: `FileChangeRequestApprovalResponse`: `decision`.
- `item/tool/requestUserInput` — 请求客户端为工具调用收集结构化用户输入。 入参: `ToolRequestUserInputParams`: `autoResolutionMs?`, `isBlocking`, `itemId`, `questions`, `threadId`, `turnId`. 出参: `ToolRequestUserInputResponse`: `answers`.
- `item/permissions/requestApproval` — 请求客户端批准额外权限。 入参: `PermissionsRequestApprovalParams`: `cwd`, `environmentId?`, `itemId`, `permissions`, `reason?`, `startedAtMs`, `threadId`, `turnId`. 出参: `PermissionsRequestApprovalResponse`: `permissions`, `scope?`, `strictAutoReview?`.
- `item/tool/call` — 请求客户端执行已注册的动态工具。 入参: `DynamicToolCallParams`: `arguments`, `callId`, `namespace?`, `threadId`, `tool`, `turnId`. 出参: `DynamicToolCallResponse`: `contentItems`, `success`.

### MCP Server

- `mcpServer/elicitation/request` — 请求客户端响应 MCP elicitation。 入参: `McpServerElicitationRequestParams`: `serverName`, `threadId`, `turnId?`. 出参: `McpServerElicitationRequestResponse`: `_meta?`, `action`, `content?`.

### 账户

- `account/chatgptAuthTokens/refresh` — 请求客户端刷新 ChatGPT 认证令牌。 入参: `ChatgptAuthTokensRefreshParams`: `previousAccountId?`, `reason`. 出参: `ChatgptAuthTokensRefreshResponse`: `accessToken`, `chatgptAccountId`, `chatgptPlanType?`.

### attestation

- `attestation/generate` — 请求客户端生成新的 attestation 令牌。 入参: `AttestationGenerateParams`: `{}`. 出参: `AttestationGenerateResponse`: `token`.

### currentTime

- `currentTime/read` — 从客户端拥有的外部时钟读取时间。 入参: `CurrentTimeReadParams`: `threadId`. 出参: `CurrentTimeReadResponse`: `currentTimeAt`.

### applyPatchApproval

- `applyPatchApproval` — 旧版补丁审批请求。 入参: `ApplyPatchApprovalParams`: `callId`, `conversationId`, `fileChanges`, `grantRoot?`, `reason?`. 出参: `ApplyPatchApprovalResponse`: `decision`.

### execCommandApproval

- `execCommandApproval` — 旧版命令执行审批请求。 入参: `ExecCommandApprovalParams`: `approvalId?`, `callId`, `command`, `conversationId`, `cwd`, `parsedCmd`, `reason?`. 出参: `ExecCommandApprovalResponse`: `decision`.

## 服务端通知（83）

### error

- `error` — 推送 `error` 事件。 载荷: `ErrorNotification`: `error`, `threadId`, `turnId`, `willRetry`.

### 任务线程

- `thread/started` — 推送 `thread/started` 事件。 载荷: `ThreadStartedNotification`: `thread`.
- `thread/status/changed` — 推送 `thread/status/changed` 事件。 载荷: `ThreadStatusChangedNotification`: `status`, `threadId`.
- `thread/archived` — 推送 `thread/archived` 事件。 载荷: `ThreadArchivedNotification`: `threadId`.
- `thread/deleted` — 推送 `thread/deleted` 事件。 载荷: `ThreadDeletedNotification`: `threadId`.
- `thread/unarchived` — 推送 `thread/unarchived` 事件。 载荷: `ThreadUnarchivedNotification`: `threadId`.
- `thread/closed` — 推送 `thread/closed` 事件。 载荷: `ThreadClosedNotification`: `threadId`.
- `thread/reverted` — 推送 `thread/reverted` 事件。 载荷: `ThreadRevertedNotification`: `threadId`.
- `thread/name/updated` — 推送 `thread/name/updated` 事件。 载荷: `ThreadNameUpdatedNotification`: `threadId`, `threadName?`.
- `thread/goal/updated` — 推送 `thread/goal/updated` 事件。 载荷: `ThreadGoalUpdatedNotification`: `goal`, `threadId`, `turnId?`.
- `thread/goal/cleared` — 推送 `thread/goal/cleared` 事件。 载荷: `ThreadGoalClearedNotification`: `threadId`.
- `thread/queue/changed` — 推送 `thread/queue/changed` 事件。 载荷: `ThreadQueueChangedNotification`: `threadId`.
- `thread/project/updated` — 推送 `thread/project/updated` 事件。 载荷: `ThreadProjectUpdatedNotification`: `projectId`, `threadId`.
- `thread/environment/connected` — 推送 `thread/environment/connected` 事件。 载荷: `EnvironmentConnectionNotification`: `environmentId`, `threadId`.
- `thread/environment/disconnected` — 推送 `thread/environment/disconnected` 事件。 载荷: `EnvironmentConnectionNotification`: `environmentId`, `threadId`.
- `thread/settings/updated` — 推送 `thread/settings/updated` 事件。 载荷: `ThreadSettingsUpdatedNotification`: `threadId`, `threadSettings`.
- `thread/tokenUsage/updated` — 推送 `thread/tokenUsage/updated` 事件。 载荷: `ThreadTokenUsageUpdatedNotification`: `threadId`, `tokenUsage`, `turnId`.
- `thread/compacted` — 推送 `thread/compacted` 事件。 载荷: `ContextCompactedNotification`: `threadId`, `turnId`.
- `thread/realtime/started` — 推送 `thread/realtime/started` 事件。 载荷: `ThreadRealtimeStartedNotification`: `realtimeSessionId?`, `threadId`, `version`.
- `thread/realtime/itemAdded` — 推送 `thread/realtime/itemAdded` 事件。 载荷: `ThreadRealtimeItemAddedNotification`: `item`, `threadId`.
- `thread/realtime/item/started` — 推送 `thread/realtime/item/started` 事件。 载荷: `ThreadRealtimeItemStartedNotification`: `item`, `threadId`.
- `thread/realtime/item/transcript/delta` — 推送 `thread/realtime/item/transcript/delta` 事件。 载荷: `ThreadRealtimeItemTranscriptDeltaNotification`: `delta`, `itemId`, `threadId`.
- `thread/realtime/item/completed` — 推送 `thread/realtime/item/completed` 事件。 载荷: `ThreadRealtimeItemCompletedNotification`: `item`, `threadId`.
- `thread/realtime/transcript/delta` — 推送 `thread/realtime/transcript/delta` 事件。 载荷: `ThreadRealtimeTranscriptDeltaNotification`: `delta`, `role`, `threadId`.
- `thread/realtime/transcript/done` — 推送 `thread/realtime/transcript/done` 事件。 载荷: `ThreadRealtimeTranscriptDoneNotification`: `role`, `text`, `threadId`.
- `thread/realtime/outputAudio/delta` — 推送 `thread/realtime/outputAudio/delta` 事件。 载荷: `ThreadRealtimeOutputAudioDeltaNotification`: `audio`, `threadId`.
- `thread/realtime/sdp` — 推送 `thread/realtime/sdp` 事件。 载荷: `ThreadRealtimeSdpNotification`: `sdp`, `threadId`.
- `thread/realtime/error` — 推送 `thread/realtime/error` 事件。 载荷: `ThreadRealtimeErrorNotification`: `message`, `threadId`.
- `thread/realtime/closed` — 推送 `thread/realtime/closed` 事件。 载荷: `ThreadRealtimeClosedNotification`: `reason?`, `threadId`.

### 技能

- `skills/changed` — 推送 `skills/changed` 事件。 载荷: `SkillsChangedNotification`: `{}`.

### 项目

- `project/changed` — 推送 `project/changed` 事件。 载荷: `ProjectChangedNotification`: `changeType`, `projectId`.

### 轮次

- `turn/started` — 推送 `turn/started` 事件。 载荷: `TurnStartedNotification`: `threadId`, `turn`.
- `turn/completed` — 推送 `turn/completed` 事件。 载荷: `TurnCompletedNotification`: `threadId`, `turn`.
- `turn/diff/updated` — 推送 `turn/diff/updated` 事件。 载荷: `TurnDiffUpdatedNotification`: `diff`, `threadId`, `turnId`.
- `turn/plan/updated` — 推送 `turn/plan/updated` 事件。 载荷: `TurnPlanUpdatedNotification`: `explanation?`, `plan`, `threadId`, `turnId`.
- `turn/moderationMetadata` — 推送 `turn/moderationMetadata` 事件。 载荷: `TurnModerationMetadataNotification`: `metadata`, `threadId`, `turnId`.

### hook

- `hook/started` — 推送 `hook/started` 事件。 载荷: `HookStartedNotification`: `run`, `threadId`, `turnId?`.
- `hook/completed` — 推送 `hook/completed` 事件。 载荷: `HookCompletedNotification`: `run`, `threadId`, `turnId?`.

### item

- `item/started` — 推送 `item/started` 事件。 载荷: `ItemStartedNotification`: `item`, `startedAtMs`, `threadId`, `turnId`.
- `item/autoApprovalReview/started` — 推送 `item/autoApprovalReview/started` 事件。 载荷: `ItemGuardianApprovalReviewStartedNotification`: `action`, `review`, `reviewId`, `startedAtMs`, `targetItemId?`, `threadId`, `turnId`.
- `item/autoApprovalReview/completed` — 推送 `item/autoApprovalReview/completed` 事件。 载荷: `ItemGuardianApprovalReviewCompletedNotification`: `action`, `completedAtMs`, `decisionSource`, `review`, `reviewId`, `startedAtMs`, `targetItemId?`, `threadId`, `turnId`.
- `item/completed` — 推送 `item/completed` 事件。 载荷: `ItemCompletedNotification`: `completedAtMs`, `item`, `threadId`, `turnId`.
- `item/agentMessage/delta` — 推送 `item/agentMessage/delta` 事件。 载荷: `AgentMessageDeltaNotification`: `delta`, `itemId`, `threadId`, `turnId`.
- `item/plan/delta` — 推送 `item/plan/delta` 事件。 载荷: `PlanDeltaNotification`: `delta`, `itemId`, `threadId`, `turnId`.
- `item/commandExecution/outputDelta` — 推送 `item/commandExecution/outputDelta` 事件。 载荷: `CommandExecutionOutputDeltaNotification`: `delta`, `itemId`, `threadId`, `turnId`.
- `item/commandExecution/terminalInteraction` — 推送 `item/commandExecution/terminalInteraction` 事件。 载荷: `TerminalInteractionNotification`: `itemId`, `processId`, `stdin`, `threadId`, `turnId`.
- `item/fileChange/outputDelta` — 推送 `item/fileChange/outputDelta` 事件。 载荷: `FileChangeOutputDeltaNotification`: `delta`, `itemId`, `threadId`, `turnId`.
- `item/fileChange/patchUpdated` — 推送 `item/fileChange/patchUpdated` 事件。 载荷: `FileChangePatchUpdatedNotification`: `changes`, `itemId`, `threadId`, `turnId`.
- `item/mcpToolCall/progress` — 推送 `item/mcpToolCall/progress` 事件。 载荷: `McpToolCallProgressNotification`: `itemId`, `message`, `threadId`, `turnId`.
- `item/reasoning/summaryTextDelta` — 推送 `item/reasoning/summaryTextDelta` 事件。 载荷: `ReasoningSummaryTextDeltaNotification`: `delta`, `itemId`, `summaryIndex`, `threadId`, `turnId`.
- `item/reasoning/summaryPartAdded` — 推送 `item/reasoning/summaryPartAdded` 事件。 载荷: `ReasoningSummaryPartAddedNotification`: `itemId`, `summaryIndex`, `threadId`, `turnId`.
- `item/reasoning/textDelta` — 推送 `item/reasoning/textDelta` 事件。 载荷: `ReasoningTextDeltaNotification`: `contentIndex`, `delta`, `itemId`, `threadId`, `turnId`.

### autoApprovalReview

- `autoApprovalReview/strictReviewRequired` — 推送 `autoApprovalReview/strictReviewRequired` 事件。 载荷: `StrictReviewRequiredNotification`: `startedAtMs`, `threadId`, `turnId`.

### rawResponseItem

- `rawResponseItem/completed` — 推送 `rawResponseItem/completed` 事件。 载荷: `RawResponseItemCompletedNotification`: `item`, `threadId`, `turnId`.

### rawResponse

- `rawResponse/completed` — 推送 `rawResponse/completed` 事件。 载荷: `RawResponseCompletedNotification`: `responseId`, `threadId`, `turnId`, `usage?`, `usageMetadata?`.

### 沙箱命令

- `command/exec/outputDelta` — 推送 `command/exec/outputDelta` 事件。 载荷: `CommandExecOutputDeltaNotification`: `capReached`, `deltaBase64`, `processId`, `stream`.

### 非沙箱进程

- `process/outputDelta` — 推送 `process/outputDelta` 事件。 载荷: `ProcessOutputDeltaNotification`: `capReached`, `deltaBase64`, `processHandle`, `stream`.
- `process/exited` — 推送 `process/exited` 事件。 载荷: `ProcessExitedNotification`: `exitCode`, `processHandle`, `stderr`, `stderrCapReached`, `stdout`, `stdoutCapReached`.

### serverRequest

- `serverRequest/resolved` — 推送 `serverRequest/resolved` 事件。 载荷: `ServerRequestResolvedNotification`: `requestId`, `threadId`.

### MCP Server

- `mcpServer/oauthLogin/completed` — 推送 `mcpServer/oauthLogin/completed` 事件。 载荷: `McpServerOauthLoginCompletedNotification`: `error?`, `name`, `success`, `threadId?`.
- `mcpServer/startupStatus/updated` — 推送 `mcpServer/startupStatus/updated` 事件。 载荷: `McpServerStatusUpdatedNotification`: `error?`, `failureReason?`, `name`, `status`, `threadId?`.
- `mcpServer/event/stream/notification` — 推送 `mcpServer/event/stream/notification` 事件。 载荷: `McpServerEventStreamNotification`: `notification`, `subscriptionId`.

### 账户

- `account/updated` — 推送 `account/updated` 事件。 载荷: `AccountUpdatedNotification`: `authMode?`, `planType?`.
- `account/rateLimits/updated` — 推送 `account/rateLimits/updated` 事件。 载荷: `AccountRateLimitsUpdatedNotification`: `rateLimits`.
- `account/login/completed` — 推送 `account/login/completed` 事件。 载荷: `AccountLoginCompletedNotification`: `error?`, `loginId?`, `onboardingEntrypoint?`, `success`.

### 应用

- `app/list/updated` — 推送 `app/list/updated` 事件。 载荷: `AppListUpdatedNotification`: `data`.

### 远程控制

- `remoteControl/status/changed` — 推送 `remoteControl/status/changed` 事件。 载荷: `RemoteControlStatusChangedNotification`: `environmentId?`, `installationId`, `serverName`, `status`.

### 外部 Agent 配置

- `externalAgentConfig/import/progress` — 推送 `externalAgentConfig/import/progress` 事件。 载荷: `ExternalAgentConfigImportProgressNotification`: `importId`, `itemTypeResults`.
- `externalAgentConfig/import/completed` — 推送 `externalAgentConfig/import/completed` 事件。 载荷: `ExternalAgentConfigImportCompletedNotification`: `importId`, `itemTypeResults`.

### 文件系统

- `fs/changed` — 推送 `fs/changed` 事件。 载荷: `FsChangedNotification`: `changedPaths`, `watchId`.

### 模型

- `model/rerouted` — 推送 `model/rerouted` 事件。 载荷: `ModelReroutedNotification`: `fromModel`, `reason`, `threadId`, `toModel`, `turnId`.
- `model/verification` — 推送 `model/verification` 事件。 载荷: `ModelVerificationNotification`: `threadId`, `turnId`, `verifications`.
- `model/safetyBuffering/updated` — 推送 `model/safetyBuffering/updated` 事件。 载荷: `ModelSafetyBufferingUpdatedNotification`: `fasterModel?`, `model`, `reasons`, `showBufferingUi`, `threadId`, `turnId`, `useCases`.

### 模型提供方

- `modelProvider/authRecoveryStarted` — 推送 `modelProvider/authRecoveryStarted` 事件。 载荷: `AuthRecoveryNotification`: `message`, `provider`, `threadId`, `turnId`.
- `modelProvider/authRecoveryCompleted` — 推送 `modelProvider/authRecoveryCompleted` 事件。 载荷: `AuthRecoveryNotification`: `message`, `provider`, `threadId`, `turnId`.

### warning

- `warning` — 推送 `warning` 事件。 载荷: `WarningNotification`: `message`, `threadId?`.

### guardianWarning

- `guardianWarning` — 推送 `guardianWarning` 事件。 载荷: `GuardianWarningNotification`: `message`, `threadId`.

### deprecationNotice

- `deprecationNotice` — 推送 `deprecationNotice` 事件。 载荷: `DeprecationNoticeNotification`: `details?`, `summary`.

### configWarning

- `configWarning` — 推送 `configWarning` 事件。 载荷: `ConfigWarningNotification`: `details?`, `path?`, `range?`, `summary`.

### 模糊文件搜索

- `fuzzyFileSearch/sessionUpdated` — 推送 `fuzzyFileSearch/sessionUpdated` 事件。 载荷: `FuzzyFileSearchSessionUpdatedNotification`: `files`, `query`, `sessionId`.
- `fuzzyFileSearch/sessionCompleted` — 推送 `fuzzyFileSearch/sessionCompleted` 事件。 载荷: `FuzzyFileSearchSessionCompletedNotification`: `sessionId`.

### Windows

- `windows/worldWritableWarning` — 推送 `windows/worldWritableWarning` 事件。 载荷: `WindowsWorldWritableWarningNotification`: `extraCount`, `failedScan`, `samplePaths`.

### Windows 沙箱

- `windowsSandbox/setupCompleted` — 推送 `windowsSandbox/setupCompleted` 事件。 载荷: `WindowsSandboxSetupCompletedNotification`: `error?`, `mode`, `success`.

## 客户端通知（1）

- `initialized` — 成功收到 `initialize` 响应后发送，表示客户端已准备就绪；没有 `id`、`params` 或响应。
