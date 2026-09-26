import { atomWithValidatedStorage } from "@cypheria/storage/jotai"
import type { SetStateAction } from "jotai/vanilla"
import { getDefaultStore, type WritableAtom } from "jotai/vanilla"
import {
  type ClientSettingDefinition,
  type ComposerDraft,
  ComposerDraftSchema,
  clientSettingDefinitions,
  composerDraftKey,
  type PanelLayoutCheckpoint,
  PanelLayoutCheckpointSchema,
  panelLayoutKey,
} from "../../ipc/src/index.js"

import { desktopClientStorage } from "./storage.js"

export type ClientStateAtom<Value> = WritableAtom<
  Value,
  [SetStateAction<Value>],
  void | Promise<void>
>

function atomFor<Value>(
  definition: ClientSettingDefinition<Value>,
  initialValue?: Value
): ClientStateAtom<Value>
function atomFor(
  definition: ClientSettingDefinition<unknown>,
  initialValue?: unknown
): ClientStateAtom<unknown> {
  return atomWithValidatedStorage<unknown>(
    definition.key,
    initialValue ?? definition.defaultValue,
    desktopClientStorage.keyValue,
    definition.schema,
    { getOnInit: true, version: definition.version }
  ) as unknown as ClientStateAtom<unknown>
}

export const clientStateStore = getDefaultStore()

export const appearanceAtom = atomFor(
  clientSettingDefinitions.appearance,
  typeof window === "undefined" ? undefined : window.cypheria?.bootstrap.appearance
)
export const localeOverrideAtom = atomFor(
  clientSettingDefinitions.localeOverride,
  typeof window === "undefined" ? undefined : window.cypheria?.bootstrap.language.localeOverride
)
export const projectlessWorkspaceRootAtom = atomFor(
  clientSettingDefinitions.projectlessWorkspaceRoot
)
export const openInTargetPreferenceAtom = atomFor(clientSettingDefinitions.openInTargetPreference)
export const macMenuBarEnabledAtom = atomFor(clientSettingDefinitions.macMenuBarEnabled)
export const preventSleepWhileRunningAtom = atomFor(
  clientSettingDefinitions.preventSleepWhileRunning
)
export const permissionModeVisibilityAtom = atomFor(
  clientSettingDefinitions.permissionModeVisibility
)
export const composerPlainTextModeAtom = atomFor(clientSettingDefinitions.composerPlainTextMode)
export const showContextWindowUsageAtom = atomFor(clientSettingDefinitions.showContextWindowUsage)
export const composerEnterBehaviorAtom = atomFor(clientSettingDefinitions.composerEnterBehavior)
export const followUpQueueModeAtom = atomFor(clientSettingDefinitions.followUpQueueMode)
export const defaultTerminalLocationAtom = atomFor(clientSettingDefinitions.defaultTerminalLocation)
export const showBottomPanelControlAtom = atomFor(clientSettingDefinitions.showBottomPanelControl)
export const hotkeyWindowHotkeyAtom = atomFor(clientSettingDefinitions.hotkeyWindowHotkey)
export const hotkeyWindowProjectlessDefaultEnabledAtom = atomFor(
  clientSettingDefinitions.hotkeyWindowProjectlessDefaultEnabled
)
export const notificationsTurnModeAtom = atomFor(clientSettingDefinitions.notificationsTurnMode)
export const notificationsPermissionsEnabledAtom = atomFor(
  clientSettingDefinitions.notificationsPermissionsEnabled
)
export const notificationsQuestionsEnabledAtom = atomFor(
  clientSettingDefinitions.notificationsQuestionsEnabled
)
export const notificationSoundAtom = atomFor(clientSettingDefinitions.notificationSound)
export const sidebarOrganizationAtom = atomFor(clientSettingDefinitions.sidebarOrganization)
export const pinnedSidebarSortAtom = atomFor(clientSettingDefinitions.pinnedSidebarSort)
export const chatSidebarSortAtom = atomFor(clientSettingDefinitions.chatSidebarSort)
export const gitReviewSourceAtom = atomFor(clientSettingDefinitions.gitReviewSource)
export const unreadThreadIdsAtom = atomFor(clientSettingDefinitions.unreadThreadIds)

const draftAtoms = new Map<string, ClientStateAtom<ComposerDraft | null>>()
export const composerDraftAtom = (scopeId: string): ClientStateAtom<ComposerDraft | null> => {
  const existing = draftAtoms.get(scopeId)
  if (existing) return existing
  const created = atomWithValidatedStorage<ComposerDraft | null>(
    composerDraftKey(scopeId),
    null,
    desktopClientStorage.keyValue,
    ComposerDraftSchema.nullable(),
    { getOnInit: true, version: 1 }
  )
  const atom = created as unknown as ClientStateAtom<ComposerDraft | null>
  draftAtoms.set(scopeId, atom)
  return atom
}

const panelAtoms = new Map<string, ClientStateAtom<PanelLayoutCheckpoint | null>>()
export const panelLayoutAtom = (
  threadId: string
): ClientStateAtom<PanelLayoutCheckpoint | null> => {
  const existing = panelAtoms.get(threadId)
  if (existing) return existing
  const created = atomWithValidatedStorage<PanelLayoutCheckpoint | null>(
    panelLayoutKey(threadId),
    null,
    desktopClientStorage.keyValue,
    PanelLayoutCheckpointSchema.nullable(),
    { getOnInit: true, version: 1 }
  )
  const atom = created as unknown as ClientStateAtom<PanelLayoutCheckpoint | null>
  panelAtoms.set(threadId, atom)
  return atom
}
