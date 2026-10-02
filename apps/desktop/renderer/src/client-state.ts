import { atomWithValidatedStorage } from "@cypheria/storage/jotai"
import type { SetStateAction } from "jotai/vanilla"
import { getDefaultStore, type WritableAtom } from "jotai/vanilla"
import { z } from "zod"
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
export const gitReviewDiffDisplayAtom = atomFor(clientSettingDefinitions.gitReviewDiffDisplay)
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

export type SummaryCheckpoint = {
  open: boolean
  pinned: boolean
  expanded: Record<string, boolean>
}

export type ThreadFilesCheckpoint = {
  activeRoot: string | null
  expandedByRoot: Record<string, string[]>
  treeOpen: boolean
  treeWidth: number
}

const ThreadFilesCheckpointSchema = z.object({
  activeRoot: z.string().nullable(),
  expandedByRoot: z.record(z.string(), z.array(z.string())),
  treeOpen: z.boolean(),
  treeWidth: z.number().min(208).max(560),
})
const threadFilesAtoms = new Map<string, ClientStateAtom<ThreadFilesCheckpoint>>()
export const threadFilesAtom = (threadId: string): ClientStateAtom<ThreadFilesCheckpoint> => {
  const existing = threadFilesAtoms.get(threadId)
  if (existing) return existing
  const created = atomWithValidatedStorage<ThreadFilesCheckpoint>(
    `thread-files:${threadId}`,
    {
      activeRoot: null,
      expandedByRoot: {},
      treeOpen: true,
      treeWidth: 352,
    },
    desktopClientStorage.keyValue,
    ThreadFilesCheckpointSchema,
    { getOnInit: true, version: 1 }
  ) as unknown as ClientStateAtom<ThreadFilesCheckpoint>
  threadFilesAtoms.set(threadId, created)
  return created
}

const SummaryCheckpointSchema = z.object({
  open: z.boolean(),
  pinned: z.boolean(),
  expanded: z.record(z.string(), z.boolean()),
})
const summaryAtoms = new Map<string, ClientStateAtom<SummaryCheckpoint>>()
export const summaryAtom = (threadId: string): ClientStateAtom<SummaryCheckpoint> => {
  const existing = summaryAtoms.get(threadId)
  if (existing) return existing
  const created = atomWithValidatedStorage<SummaryCheckpoint>(
    `thread-summary-ui:${threadId}`,
    { open: false, pinned: false, expanded: {} },
    desktopClientStorage.keyValue,
    SummaryCheckpointSchema,
    { getOnInit: true, version: 1 }
  ) as unknown as ClientStateAtom<SummaryCheckpoint>
  summaryAtoms.set(threadId, created)
  return created
}
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

/** A comment on a changed line of a local Review, waiting to be sent to the Thread's Agent. */
export type ReviewComment = {
  readonly body: string
  readonly id: string
  readonly lineNumber: number
  /** First line of a commented range that ends at `lineNumber`. */
  readonly startLineNumber?: number
  readonly path: string
  readonly side: "additions" | "deletions"
  /** The Review source the line was read from, such as `unstaged` or `branch`. */
  readonly source: string
}

const ReviewCommentSchema = z.object({
  body: z.string().max(20_000),
  id: z.string().min(1),
  lineNumber: z.int().positive(),
  startLineNumber: z.int().positive().optional(),
  path: z.string().min(1),
  side: z.enum(["additions", "deletions"]),
  source: z.string().min(1),
})
const reviewCommentAtoms = new Map<string, ClientStateAtom<ReviewComment[]>>()
/** Pending Review comments of one Thread, or of one working directory without a Thread. */
export const reviewCommentsAtom = (scope: string): ClientStateAtom<ReviewComment[]> => {
  const existing = reviewCommentAtoms.get(scope)
  if (existing) return existing
  const created = atomWithValidatedStorage<ReviewComment[]>(
    `review-comments:${scope}`,
    [],
    desktopClientStorage.keyValue,
    z.array(ReviewCommentSchema).max(500),
    { getOnInit: true, version: 1 }
  ) as unknown as ClientStateAtom<ReviewComment[]>
  reviewCommentAtoms.set(scope, created)
  return created
}

const reviewViewedAtoms = new Map<string, ClientStateAtom<Record<string, string>>>()
/**
 * Files marked as viewed in one Review scope, each with the fingerprint of the diff that was
 * viewed; a file whose diff changed since then reads as unviewed again.
 */
export const reviewViewedAtom = (scope: string): ClientStateAtom<Record<string, string>> => {
  const existing = reviewViewedAtoms.get(scope)
  if (existing) return existing
  const created = atomWithValidatedStorage<Record<string, string>>(
    `review-viewed:${scope}`,
    {},
    desktopClientStorage.keyValue,
    z
      .record(z.string().min(1).max(4096), z.string().max(64))
      .refine((value) => Object.keys(value).length <= 5000),
    { getOnInit: true, version: 1 }
  ) as unknown as ClientStateAtom<Record<string, string>>
  reviewViewedAtoms.set(scope, created)
  return created
}
