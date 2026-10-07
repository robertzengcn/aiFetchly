import type { AIArtifactToolMetadata } from "@/entityTypes/aiArtifactTypes";

/**
 * Extract a typed artifact pointer from a raw Chat V2 tool result.
 *
 * Returns `undefined` for malformed payloads so the artifact card never
 * renders from invalid data. The renderer trusts the main-process tool
 * result shape but validates defensively at the boundary.
 *
 * Used both for rendering the card from history and for driving auto-open
 * during a live `tool_result` chunk.
 */
export function extractArtifactMetadata(
  toolResult: Record<string, unknown> | undefined | null
): AIArtifactToolMetadata | undefined {
  if (!toolResult || typeof toolResult !== "object") return undefined;
  const artifact = toolResult.artifact;
  if (!artifact || typeof artifact !== "object") return undefined;
  const raw = artifact as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    raw.type !== "html" ||
    typeof raw.title !== "string" ||
    raw.mimeType !== "text/html"
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    conversationId:
      typeof raw.conversationId === "string" ? raw.conversationId : "",
    type: "html",
    title: raw.title,
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    mimeType: "text/html",
    version: typeof raw.version === "number" ? raw.version : 1,
    createdAt:
      typeof raw.createdAt === "string"
        ? raw.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : new Date().toISOString(),
    openImmediately: raw.openImmediately !== false,
  };
}

/** Message shape accepted by ensureArtifactMetadata. */
export interface MessageWithMaybeArtifactMetadata {
  messageType?: unknown;
  metadata?: {
    toolResult?: unknown;
    artifact?: AIArtifactToolMetadata;
    toolOutputRefs?: unknown;
    toolOutputPreservation?: unknown;
    toolOutputPreview?: unknown;
  };
}

/**
 * Bounded preserved-output descriptors lifted to metadata top level. Same
 * subset the loop spreads into the live `tool_result` payload via
 * {@link toolResultReceiptUiMetadata}: identity + sizes + preservation only,
 * never bulk content. Returned only when the values validate defensively so
 * a malformed live payload cannot force a renderable card.
 */
export interface ToolOutputDescriptors {
  toolOutputRefs: Array<{
    outputId: string;
    capturedBytes: number;
    preservation: "complete" | "partial";
    sourceCompleteness: "complete" | "partial" | "unknown";
  }>;
  toolOutputPreservation: "complete" | "partial" | "unavailable";
  toolOutputPreview: string;
}

/**
 * Extract the preserved-output descriptors a live `tool_result` payload (or a
 * persisted `metadata.toolResult`) carries, returning them in the top-level
 * shape {@link AiChatV2Message.vue} `preservedOutput` reads. Returns
 * `undefined` when the payload has no externalized output or the descriptors
 * are malformed — the receipt card never renders from invalid data.
 *
 * Mirrors {@link extractArtifactMetadata}: the live `upsertToolResultMessage`
 * handler sets `metadata.artifact` from the payload on the same boundary, and
 * the history-reload path re-derives it via {@link ensureArtifactMetadata}. The
 * tool-output descriptors need the same live extraction or the receipt card
 * never appears during a live stream — the capture pipeline runs (descriptors
 * are persisted under `metadata.toolResult`) but the renderer reads them at
 * the top level.
 */
export function extractToolOutputDescriptors(
  toolResult: Record<string, unknown> | undefined | null
): ToolOutputDescriptors | undefined {
  if (!toolResult || typeof toolResult !== "object") return undefined;
  const refs = toolResult.toolOutputRefs;
  if (!Array.isArray(refs)) return undefined;
  const validated: ToolOutputDescriptors["toolOutputRefs"] = [];
  for (const entry of refs) {
    if (!entry || typeof entry !== "object") return undefined;
    const raw = entry as Record<string, unknown>;
    if (
      typeof raw.outputId !== "string" ||
      typeof raw.capturedBytes !== "number" ||
      (raw.preservation !== "complete" && raw.preservation !== "partial") ||
      (raw.sourceCompleteness !== "complete" &&
        raw.sourceCompleteness !== "partial" &&
        raw.sourceCompleteness !== "unknown")
    ) {
      return undefined;
    }
    validated.push({
      outputId: raw.outputId,
      capturedBytes: raw.capturedBytes,
      preservation: raw.preservation,
      sourceCompleteness: raw.sourceCompleteness,
    });
  }
  const preservation = toolResult.toolOutputPreservation;
  if (
    preservation !== "complete" &&
    preservation !== "partial" &&
    preservation !== "unavailable"
  ) {
    return undefined;
  }
  const preview = toolResult.toolOutputPreview;
  if (preview !== undefined && typeof preview !== "string") return undefined;
  return {
    toolOutputRefs: validated,
    toolOutputPreservation: preservation,
    toolOutputPreview: typeof preview === "string" ? preview : "",
  };
}

/**
 * Derive a top-level `metadata.artifact` pointer for a tool-result message
 * that lacks one. Persisted tool-result rows store only the raw `toolResult`
 * (with the artifact nested under `.artifact`); the live in-memory path sets
 * the shortcut directly, but history-loaded messages do not. Without this,
 * the artifact card disappears after closing and reopening a conversation
 * (PRD ART-009, acceptance criterion #5). Returns the message unchanged when
 * no artifact is present or the shortcut already exists.
 */
export function ensureArtifactMetadata<
  T extends MessageWithMaybeArtifactMetadata
>(message: T): T {
  const meta = message.metadata;
  if (
    meta &&
    !meta.artifact &&
    meta.toolResult &&
    typeof meta.toolResult === "object"
  ) {
    const artifact = extractArtifactMetadata(
      meta.toolResult as Record<string, unknown>
    );
    if (artifact) {
      return { ...message, metadata: { ...meta, artifact } };
    }
  }
  return message;
}

/**
 * The tool-output descriptor keys the renderer reads at metadata top level
 * ({@link AiChatV2Message.vue} `preservedOutput`). Persisted tool-result rows
 * nest these under `metadata.toolResult` (see `saveToolResultMessage` and
 * `upsertToolResultMessage`); the live in-memory `tool_result` chunk path sets
 * them at top level directly. Without a lift on history load, the preserved-
 * output card disappears after closing and reopening a conversation — the
 * bounded receipt (the whole point of the feature) would never render from
 * persisted state.
 */
const TOOL_OUTPUT_DESCRIPTOR_KEYS = [
  "toolOutputRefs",
  "toolOutputPreservation",
  "toolOutputPreview",
] as const;

/**
 * Derive top-level tool-output descriptor shortcuts for a tool-result message
 * that lacks them, lifting each from `metadata.toolResult` when the top-level
 * slot is absent. Mirrors {@link ensureArtifactMetadata}: idempotent (a message
 * that already has the top-level slots is returned unchanged), defensive (a
 * malformed `toolResult` is ignored), and returns the message unchanged when no
 * tool-output descriptors are present. Used in `loadHistory` so the receipt card
 * reappears after a restart (PRD §11 cross-restart durability).
 */
export function ensureToolOutputMetadata<
  T extends MessageWithMaybeArtifactMetadata
>(message: T): T {
  const meta = message.metadata;
  if (
    !meta ||
    !meta.toolResult ||
    typeof meta.toolResult !== "object"
  ) {
    return message;
  }
  const source = meta.toolResult as Record<string, unknown>;
  let lifted: Record<string, unknown> | null = null;
  for (const key of TOOL_OUTPUT_DESCRIPTOR_KEYS) {
    const existing = meta[key as keyof typeof meta];
    if (existing !== undefined) continue;
    const value = source[key];
    if (value !== undefined) {
      if (lifted === null) lifted = {};
      lifted[key] = value;
    }
  }
  if (lifted === null) return message;
  return { ...message, metadata: { ...meta, ...lifted } };
}
