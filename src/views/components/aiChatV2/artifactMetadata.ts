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
