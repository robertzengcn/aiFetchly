/**
 * Pure helpers that let AIChatQueryLoop enforce combined image limits and
 * build the model-only multimodal handoff for the `attach_local_images` tool.
 *
 * Kept separate from AIChatQueryLoop so they are trivially unit-testable and
 * have no dependency on the loop's mutable state.
 *
 * See PRD FR8/FR9 and Technical Design §11.1/§11.4.
 */
import type {
  OpenAIChatMessage,
  OpenAIMessageContent,
  OpenAIImageUrlContentPart,
} from "@/api/aiChatApi";
import type { ImageModelArtifact } from "@/entityTypes/aiImageAttachmentToolTypes";

/** True when a content part is an image_url part. */
function isImageUrlPart(
  part: unknown
): part is OpenAIImageUrlContentPart {
  if (typeof part !== "object" || part === null) return false;
  const p = part as { type?: unknown };
  return p.type === "image_url";
}

/** Extract image_url parts from a message's content (array form only). */
function imageUrlParts(message: OpenAIChatMessage): OpenAIImageUrlContentPart[] {
  const content = message.content as OpenAIMessageContent | null;
  if (!Array.isArray(content)) return [];
  return content.filter(isImageUrlPart);
}

/**
 * Count `image_url` content parts across the outgoing request transcript.
 * Metadata-only historical attachment rows (not represented as real parts) do
 * not count — only actual image_url parts consume request capacity.
 */
export function countImageContentParts(
  messages: readonly OpenAIChatMessage[]
): number {
  let count = 0;
  for (const message of messages) {
    count += imageUrlParts(message).length;
  }
  return count;
}

/**
 * Sum the character length of every `image_url.url` data URL in the
 * transcript. Used to enforce the cumulative client data-URL budget.
 */
export function countImageDataUrlChars(
  messages: readonly OpenAIChatMessage[]
): number {
  let total = 0;
  for (const message of messages) {
    for (const part of imageUrlParts(message)) {
      const url = part.image_url?.url;
      if (typeof url === "string") total += url.length;
    }
  }
  return total;
}

/**
 * Build the synthetic model-only `role: "user"` multimodal handoff message
 * that delivers prepared tool images to the next chat-completion round.
 *
 * The text part repeats the ORIGINAL user request so the AI server's
 * edit/analysis intent detection still sees the instruction after this
 * synthetic message becomes the latest user message. It must NOT include
 * untrusted instructions derived from filenames or image metadata — those
 * remain in the preceding metadata-only tool result.
 *
 * The message is model-only: it is not rendered as a user-authored bubble and
 * is not persisted as ordinary conversation text.
 */
export function buildImageArtifactHandoffMessage(input: {
  readonly artifacts: readonly ImageModelArtifact[];
  readonly originalUserRequest: string;
  readonly toolCallId: string;
}): OpenAIChatMessage {
  const text =
    `[AIFETCHLY_IMAGE_HANDOFF_V1]\n` +
    `The desktop attached ${input.artifacts.length} local image(s).\n` +
    `Original user request:\n${input.originalUserRequest}`;

  return {
    role: "user",
    content: [
      { type: "text", text },
      ...input.artifacts.map((artifact) => ({
        type: "image_url" as const,
        image_url: {
          url: artifact.dataUrl,
          detail: artifact.detail,
        },
      })),
    ],
  };
}
