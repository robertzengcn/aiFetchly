// src/service/persistAgentImages.ts
// Persists a sub-agent's edited/generated images to local storage and derives
// the path + descriptor outputs that ride on AgentResult. Pure helper — no
// Electron/TypeORM imports — so it is unit-testable in isolation and reusable
// by AgentRuntime without pulling the chat-loop graph into the test.
import type { OpenAIChatImage } from "@/api/aiChatApi";

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
 * the agent produced no images or storage failed. */
export interface PersistAgentImagesResult {
  /** On-disk paths of the persisted images (never bytes). */
  outputFilePaths?: string[];
  /** Persisted image descriptors (local_path + protocol URL, no bytes). */
  outputImages?: OpenAIChatImage[];
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
    // Enforce PRD non-goal 8 (no image bytes persisted) at THIS boundary.
    // AIChatGeneratedImageStorageService.storeImages is fault-tolerant: when a
    // single per-image write fails it falls back to the ORIGINAL image, which
    // still carries b64_json bytes. Strip base64 from every descriptor so the
    // AgentResult we return (and persist via taskModule.saveResult) never
    // carries bytes, regardless of what storage handed back. Descriptors keep
    // their protocol url + local_path, which is all rendering needs.
    const outputImages =
      stored.length > 0
        ? stored.map((image) => ({ ...image, b64_json: undefined }))
        : undefined;
    const paths = outputImages
      ?.map((img) => img.local_path)
      .filter((p): p is string => typeof p === "string");
    const outputFilePaths = paths && paths.length > 0 ? paths : undefined;
    return { outputFilePaths, outputImages };
  } catch (err) {
    console.warn(
      `[agent-runtime] failed to store generated images for ${input.conversationId}/${input.messageId}:`,
      err
    );
    return {};
  }
}
