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
