// src/service/persistAgentImages.ts
// Persists a sub-agent's edited/generated images to local storage and derives
// the path + descriptor outputs that ride on AgentResult. Pure helper — no
// Electron/TypeORM imports — so it is unit-testable in isolation and reusable
// by AgentRuntime without pulling the chat-loop graph into the test.
import type { OpenAIChatImage } from "@/api/aiChatApi";
import { AI_CHAT_GENERATED_IMAGE_PROTOCOL } from "@/service/AIChatGeneratedImageProtocol";

/** Storage seam for persisting generated/edited images to disk. Mirrors the
 * shape AIChatGeneratedImageStorageService (and AIChatQueryEngine's
 * generatedImageStorage dep) expose: storeImages returns descriptors with
 * local_path set and b64_json stripped. */
export interface AgentImageStorage {
  storeImages(input: {
    conversationId: string;
    messageId: string;
    images: OpenAIChatImage[];
  }): Promise<OpenAIChatImage[]>;
}

/** Result of persisting a sub-agent's edited images. All fields undefined when
 * the agent produced no images. */
export interface PersistAgentImagesResult {
  /** On-disk paths of the persisted images (never bytes). */
  outputFilePaths?: string[];
  /** Persisted image descriptors (local_path + protocol URL, no bytes). */
  outputImages?: OpenAIChatImage[];
  /** Set when some images could not be persisted (storage error, or
   * descriptors with a non-sanctioned URL were dropped). Callers should
   * surface it so the user knows the batch's artifacts may be incomplete. */
  storageWarning?: string;
}

/**
 * Persist a sub-agent's edited images to local storage and derive the
 * path/descriptor outputs for {@link AgentResult}. Bytes are never persisted
 * — storage strips b64_json and returns local_path + protocol URL descriptors
 * (PRD non-goal 8: only file paths + safe metadata are persisted).
 *
 * Failure-tolerant: if storage throws, the error is logged and swallowed so an
 * image-storage hiccup never fails an otherwise-successful agent task — the
 * caller still gets the agent's text output. Returns `{}` (all undefined) for
 * no images or on failure.
 */
export async function persistAgentImages(input: {
  images?: OpenAIChatImage[];
  conversationId: string;
  messageId: string;
  storage: AgentImageStorage;
}): Promise<PersistAgentImagesResult> {
  if (!input.images || input.images.length === 0) {
    return {};
  }
  try {
    const stored = await input.storage.storeImages({
      conversationId: input.conversationId,
      messageId: input.messageId,
      images: input.images,
    });
    // Defense-in-depth: keep ONLY descriptors that resolved to the sanctioned
    // generated-image protocol URL. Storage's per-item fallback can return the
    // ORIGINAL image (carrying a provider http/file URL) on a write failure,
    // and an external (provider) response could carry an attacker-chosen
    // file:// URL + local_path. Dropping non-protocol descriptors prevents an
    // external URL/local_path from being surfaced as a "generated image".
    const sanctionedPrefix = `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}:`;
    const accepted = stored.filter(
      (img) =>
        typeof img.url === "string" && img.url.startsWith(sanctionedPrefix)
    );
    const droppedCount = stored.length - accepted.length;
    // Enforce PRD non-goal 8 (no image bytes persisted) at THIS boundary:
    // strip base64 regardless of what storage handed back. Descriptors keep
    // their protocol url + local_path, which is all rendering needs.
    const outputImages =
      accepted.length > 0
        ? accepted.map((image) => ({ ...image, b64_json: undefined }))
        : undefined;
    const paths = outputImages
      ?.map((img) => img.local_path)
      .filter((p): p is string => typeof p === "string");
    const outputFilePaths = paths && paths.length > 0 ? paths : undefined;
    const storageWarning =
      droppedCount > 0
        ? `${droppedCount} of ${stored.length} generated image(s) could not be stored locally and were dropped.`
        : undefined;
    return { outputFilePaths, outputImages, storageWarning };
  } catch (err) {
    console.warn(
      `[agent-runtime] failed to store generated images for ${input.conversationId}/${input.messageId}:`,
      err
    );
    const msg = err instanceof Error ? err.message : String(err);
    return {
      storageWarning: `Failed to store ${input.images.length} generated image(s) locally: ${msg}`,
    };
  }
}
