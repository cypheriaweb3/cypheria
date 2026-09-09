import type { CodexTurnItemSnapshot } from "@cypheria/codex-bridge"
import type { CodexUiMessage } from "../../../ipc/src/index.js"

export type CodexActivityUnit =
  | {
      readonly id: string
      readonly item: CodexTurnItemSnapshot
      readonly kind: "commentary"
    }
  | {
      readonly id: string
      readonly item: CodexTurnItemSnapshot
      readonly kind: "item"
    }
  | {
      readonly id: string
      readonly items: readonly CodexTurnItemSnapshot[]
      readonly kind: "group"
      readonly reasoning?: CodexTurnItemSnapshot
    }

export type CodexGeneratedArtifact = {
  readonly description: string | null
  readonly id: string
  readonly kind: "app" | "artifact" | "file" | "website"
  readonly title: string
  readonly uri: string
}

export type CodexAsyncQuestion = {
  readonly id: string
  readonly options: readonly string[]
  readonly questionIndex: number | null
  readonly sourceItemId: string
  readonly title: string
}

export type CodexAsyncQuestionAnswer = {
  readonly answer: string
  readonly question: CodexAsyncQuestion
}

export type CodexTurnView = {
  readonly activity: readonly CodexActivityUnit[]
  readonly artifacts: readonly CodexGeneratedArtifact[]
  readonly asyncQuestions: readonly CodexAsyncQuestion[]
  readonly changedFileCount: number
  readonly generatedImages: readonly (CodexTurnItemSnapshot & {
    readonly item: Extract<CodexTurnItemSnapshot["item"], { type: "imageGeneration" }>
  })[]
  readonly pendingGeneratedImageCount: number
  readonly pendingGeneratedImageIds: readonly string[]
  readonly diff:
    | Extract<CodexUiMessage["parts"][number], { type: "data-codex-diff" }>["data"]
    | null
  readonly events: readonly Extract<
    CodexUiMessage["parts"][number],
    { type: "data-codex-event" }
  >["data"][]
  readonly finalAnswer: CodexTurnItemSnapshot | null
  readonly items: readonly CodexTurnItemSnapshot[]
  readonly modelReroutes: readonly Extract<
    CodexUiMessage["parts"][number],
    { type: "data-codex-model-reroute" }
  >["data"][]
  readonly plan:
    | Extract<CodexUiMessage["parts"][number], { type: "data-codex-plan" }>["data"]
    | null
  readonly turn: Extract<CodexUiMessage["parts"][number], { type: "data-codex-turn" }>["data"]
}

const isCommentary = (snapshot: CodexTurnItemSnapshot): boolean =>
  snapshot.item.type === "agentMessage" &&
  (snapshot.item.phase === "commentary" || snapshot.item.delivery === "async")

const isReasoning = (snapshot: CodexTurnItemSnapshot): boolean => snapshot.item.type === "reasoning"

const isPendingGeneratedImage = (snapshot: CodexTurnItemSnapshot): boolean =>
  snapshot.item.type === "imageGeneration" &&
  !snapshot.item.result &&
  !snapshot.item.failure &&
  ["inProgress", "in_progress", "running"].includes(snapshot.item.status)

export const isCodexTurnItemActive = (snapshot: CodexTurnItemSnapshot): boolean => {
  if (isPendingGeneratedImage(snapshot)) return true
  if (snapshot.lifecycle === "completed") return false
  const item = snapshot.item
  if ("status" in item && typeof item.status === "string") {
    return item.status === "inProgress" || item.status === "running"
  }
  return true
}

const recordValue = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const artifactFromResource = (
  value: Record<string, unknown>,
  fallbackId: string
): CodexGeneratedArtifact | null => {
  const artifact = recordValue(value.artifact)
  const artifactRef = stringValue(value.artifactRef) ?? stringValue(artifact?.ref)
  const type = stringValue(value.type) ?? (artifactRef ? "artifact-session" : null)
  if (!type || !["resource_link", "appgen-app", "artifact-session", "website"].includes(type)) {
    return null
  }
  const appRef = stringValue(value.appId) ?? stringValue(value.id)
  const rawUri =
    stringValue(value.uri) ??
    stringValue(value.url) ??
    stringValue(value.path) ??
    (artifactRef
      ? `artifact:${artifactRef}`
      : type === "appgen-app" && appRef
        ? `appgen:${appRef}`
        : null)
  if (!rawUri) return null

  const mimeType = stringValue(value.mimeType) ?? stringValue(value.mime_type)
  const kind =
    type === "appgen-app" || rawUri.startsWith("appgen:")
      ? "app"
      : type === "artifact-session" || rawUri.startsWith("artifact:")
        ? "artifact"
        : type === "website" ||
            (mimeType?.toLowerCase().startsWith("text/html") && /^https?:\/\//u.test(rawUri))
          ? "website"
          : "file"
  const title =
    stringValue(value.title) ??
    stringValue(value.name) ??
    stringValue(artifact?.title) ??
    rawUri.split(/[\\/]/u).filter(Boolean).at(-1) ??
    rawUri

  return {
    description: stringValue(value.description),
    id: `${fallbackId}:${kind}:${rawUri}`,
    kind,
    title,
    uri: rawUri,
  }
}

const collectResourceArtifacts = (
  value: unknown,
  fallbackId: string,
  depth = 0
): CodexGeneratedArtifact[] => {
  if (depth > 6) return []
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectResourceArtifacts(entry, `${fallbackId}:${index}`, depth + 1)
    )
  }
  const record = recordValue(value)
  if (!record) return []
  const artifact = artifactFromResource(record, fallbackId)
  if (artifact) return [artifact]
  return Object.entries(record).flatMap(([key, entry]) =>
    collectResourceArtifacts(entry, `${fallbackId}:${key}`, depth + 1)
  )
}

const artifactsFromFinalAnswer = (
  finalAnswer: CodexTurnItemSnapshot | null
): CodexGeneratedArtifact[] => {
  if (finalAnswer?.item.type !== "agentMessage") return []
  const artifacts: CodexGeneratedArtifact[] = []
  const markdownLink = /\[([^\]]+)\]\((?:<((?:file:\/\/|\/)[^>]+)>|((?:file:\/\/|\/)[^) \t]+))\)/gu
  const artifactExtension =
    /\.(?:csv|docx?|gif|html?|jpe?g|m4a|mov|mp3|mp4|pdf|png|pptx?|svg|tar|tsv|wav|webm|webp|xlsx?|zip)(?::\d+)?(?:$|[?#])/iu
  for (const match of finalAnswer.item.text.matchAll(markdownLink)) {
    const title = match[1]?.trim()
    const uri = (match[2] ?? match[3])?.trim()
    if (!title || !uri || !artifactExtension.test(uri)) continue
    artifacts.push({
      description: null,
      id: `assistant-file:${uri}`,
      kind: "file",
      title,
      uri,
    })
  }
  return artifacts
}

const selectGeneratedArtifacts = (
  items: readonly CodexTurnItemSnapshot[],
  finalAnswer: CodexTurnItemSnapshot | null,
  turnStatus: CodexTurnView["turn"]["status"]
): CodexGeneratedArtifact[] => {
  if (turnStatus !== "completed") return []
  const candidates = [...artifactsFromFinalAnswer(finalAnswer)]
  for (const snapshot of items) {
    if (
      snapshot.item.type !== "mcpToolCall" ||
      snapshot.item.status !== "completed" ||
      snapshot.item.error ||
      !snapshot.item.result
    ) {
      continue
    }
    candidates.push(
      ...collectResourceArtifacts(snapshot.item.result.content, snapshot.item.id),
      ...collectResourceArtifacts(snapshot.item.result.structuredContent, snapshot.item.id),
      ...collectResourceArtifacts(snapshot.item.result._meta, snapshot.item.id)
    )
  }
  return candidates.filter(
    (artifact, index) =>
      candidates.findIndex(
        (candidate) => candidate.kind === artifact.kind && candidate.uri === artifact.uri
      ) === index
  )
}

const selectFinalAnswer = (
  items: readonly CodexTurnItemSnapshot[]
): CodexTurnItemSnapshot | null => {
  const assistantItems = items.filter(
    (
      snapshot
    ): snapshot is CodexTurnItemSnapshot & {
      item: Extract<CodexTurnItemSnapshot["item"], { type: "agentMessage" }>
    } =>
      snapshot.item.type === "agentMessage" &&
      snapshot.item.delivery !== "async" &&
      snapshot.item.text.length > 0
  )
  return (
    assistantItems.findLast((snapshot) => snapshot.item.phase === "final_answer") ??
    assistantItems.findLast((snapshot) => snapshot.item.phase === null) ??
    null
  )
}

const selectAsyncQuestions = (items: readonly CodexTurnItemSnapshot[]): CodexAsyncQuestion[] =>
  items.flatMap<CodexAsyncQuestion>((snapshot) => {
    if (snapshot.item.type !== "agentMessage" || snapshot.item.delivery !== "async") return []
    const { id: sourceItemId, questions, text } = snapshot.item
    if (!questions?.length) {
      return [
        {
          id: sourceItemId,
          options: [],
          questionIndex: null,
          sourceItemId,
          title: text,
        },
      ]
    }
    return questions.map((question, questionIndex) => ({
      id: JSON.stringify(["request_user_input_async", sourceItemId, questionIndex]),
      options: question.options ?? [],
      questionIndex,
      sourceItemId,
      title: question.title,
    }))
  })

export const formatCodexAsyncQuestionReply = (
  answers: readonly CodexAsyncQuestionAnswer[]
): string =>
  `<send_user_message_question_reply>\n${JSON.stringify(
    answers.map(({ answer, question }) => ({
      answer,
      question: question.title,
      questionItemId: question.id,
    }))
  )}\n</send_user_message_question_reply>`

const countChangedFiles = (items: readonly CodexTurnItemSnapshot[]): number => {
  const paths = new Set<string>()
  for (const snapshot of items) {
    if (snapshot.item.type !== "fileChange") continue
    for (const change of snapshot.item.changes) paths.add(change.path)
  }
  return paths.size
}

export const groupCodexActivity = (
  items: readonly CodexTurnItemSnapshot[]
): CodexActivityUnit[] => {
  const groups: CodexActivityUnit[] = []
  let pending:
    | {
        id: string
        items: CodexTurnItemSnapshot[]
        kind: "group"
        reasoning?: CodexTurnItemSnapshot
      }
    | undefined

  const flush = () => {
    if (pending && (pending.reasoning || pending.items.length)) groups.push(pending)
    pending = undefined
  }

  for (const snapshot of items) {
    if (isCommentary(snapshot)) {
      flush()
      groups.push({ id: snapshot.item.id, item: snapshot, kind: "commentary" })
      continue
    }
    if (snapshot.item.type === "imageGeneration") {
      flush()
      groups.push({ id: snapshot.item.id, item: snapshot, kind: "item" })
      continue
    }
    if (isReasoning(snapshot)) {
      flush()
      pending = {
        id: `reasoning-group:${snapshot.item.id}`,
        items: [],
        kind: "group",
        reasoning: snapshot,
      }
      continue
    }
    pending ??= { id: `activity-group:${snapshot.item.id}`, items: [], kind: "group" }
    pending.items.push(snapshot)
  }
  flush()
  return groups
}

export const deriveCodexTurnView = (message: CodexUiMessage): CodexTurnView | null => {
  let turn: CodexTurnView["turn"] | null = null
  let diff: CodexTurnView["diff"] = null
  let plan: CodexTurnView["plan"] = null
  const items: CodexTurnItemSnapshot[] = []
  const events: CodexTurnView["events"][number][] = []
  const modelReroutes: CodexTurnView["modelReroutes"][number][] = []

  for (const part of message.parts) {
    switch (part.type) {
      case "data-codex-turn":
        turn = part.data
        break
      case "data-codex-item":
        items.push(part.data)
        break
      case "data-codex-diff":
        diff = part.data
        break
      case "data-codex-plan":
        plan = part.data
        break
      case "data-codex-model-reroute":
        modelReroutes.push(part.data)
        break
      case "data-codex-event":
        events.push(part.data)
        break
    }
  }
  if (!turn) return null

  items.sort((left, right) => left.order - right.order)
  const finalAnswer = selectFinalAnswer(items)
  const asyncQuestions = selectAsyncQuestions(items)
  const artifacts = selectGeneratedArtifacts(items, finalAnswer, turn.status)
  const hidesImageGallery = artifacts.some(
    (artifact) => artifact.kind === "file" && /\.pptx(?:$|[?#])/iu.test(artifact.uri)
  )
  const allGeneratedImages = items.filter(
    (
      snapshot
    ): snapshot is CodexTurnItemSnapshot & {
      item: Extract<CodexTurnItemSnapshot["item"], { type: "imageGeneration" }>
    } =>
      snapshot.item.type === "imageGeneration" &&
      Boolean(snapshot.item.result) &&
      !snapshot.item.failure
  )
  const generatedImages = hidesImageGallery ? [] : allGeneratedImages
  const generatedImageIds = new Set(allGeneratedImages.map((snapshot) => snapshot.item.id))
  const pendingGeneratedImageIds = new Set(
    turn.status === "inProgress" && !hidesImageGallery
      ? items.filter(isPendingGeneratedImage).map((snapshot) => snapshot.item.id)
      : []
  )
  const activityItems = items.filter(
    (snapshot) =>
      snapshot.item.id !== finalAnswer?.item.id &&
      !generatedImageIds.has(snapshot.item.id) &&
      !pendingGeneratedImageIds.has(snapshot.item.id) &&
      snapshot.item.type !== "userMessage" &&
      snapshot.item.type !== "hookPrompt"
  )
  return {
    activity: groupCodexActivity(activityItems),
    artifacts,
    asyncQuestions,
    changedFileCount: countChangedFiles(items),
    diff,
    events,
    finalAnswer,
    generatedImages,
    items,
    modelReroutes,
    pendingGeneratedImageCount: pendingGeneratedImageIds.size,
    pendingGeneratedImageIds: [...pendingGeneratedImageIds],
    plan,
    turn,
  }
}
