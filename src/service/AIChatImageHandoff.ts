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
  OpenAITextContentPart,
} from "@/api/aiChatApi";
import type { ImageModelArtifact } from "@/entityTypes/aiImageAttachmentToolTypes";

/** Marker prefix for synthetic attach_local_images handoff messages. */
export const IMAGE_HANDOFF_MARKER = "[AIFETCHLY_IMAGE_HANDOFF_V1]";

/** True when a content part is an image_url part. */
function isImageUrlPart(part: unknown): part is OpenAIImageUrlContentPart {
  if (typeof part !== "object" || part === null) return false;
  const p = part as { type?: unknown };
  return p.type === "image_url";
}

/** Extract image_url parts from a message's content (array form only). */
function imageUrlParts(
  message: OpenAIChatMessage
): OpenAIImageUrlContentPart[] {
  const content = message.content as OpenAIMessageContent | null;
  if (!Array.isArray(content)) return [];
  return content.filter(isImageUrlPart);
}

function handoffTextParts(message: OpenAIChatMessage): OpenAITextContentPart[] {
  const content = message.content as OpenAIMessageContent | null;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (part): part is OpenAITextContentPart =>
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
  );
}

/**
 * True when a message is a synthetic attach_local_images handoff carrying
 * (or formerly carrying) prepared local images.
 */
export function isImageHandoffMessage(message: OpenAIChatMessage): boolean {
  if (message.role !== "user") return false;
  return handoffTextParts(message).some((part) =>
    part.text.includes(IMAGE_HANDOFF_MARKER)
  );
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
 * After the model has already seen a handoff in a prior completion round
 * (there is a later assistant message), drop its image_url parts and keep
 * only the text summary.
 *
 * This frees the per-request 3-image budget for the next batch once the AI
 * server has finished with the previous images, and avoids resending large
 * data URLs on every subsequent round. Mutates `messages` in place.
 *
 * @returns number of image_url parts removed
 */
export function stripConsumedImageHandoffs(
  messages: OpenAIChatMessage[]
): number {
  let removed = 0;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!isImageHandoffMessage(message)) continue;
    const imageParts = imageUrlParts(message);
    if (imageParts.length === 0) continue;

    const consumedByLaterAssistant = messages
      .slice(i + 1)
      .some((later) => later.role === "assistant");
    if (!consumedByLaterAssistant) continue;

    const textParts = handoffTextParts(message);
    const textOnly: OpenAITextContentPart[] =
      textParts.length > 0
        ? textParts
        : [
            {
              type: "text",
              text:
                `${IMAGE_HANDOFF_MARKER}\n` +
                `Previously attached ${imageParts.length} local image(s) ` +
                `(bytes released after the model round completed).`,
            },
          ];

    messages[i] = {
      ...message,
      content: textOnly,
    };
    removed += imageParts.length;
  }
  return removed;
}

/**
 * After the model has already seen a user message's images in a prior
 * completion round (there is a later assistant message), drop its
 * `image_url` parts and keep only the text content.
 *
 * User-uploaded images can be large (up to 1.5MB → ~2M base64 chars →
 * ~500k tokens each). During a multi-round turn (where the model makes
 * tool calls), the user's original image data URL is re-sent on EVERY
 * round. Stripping it after the first assistant response prevents a
 * 5-round turn from re-sending the same 500k-token image 5 times.
 *
 * This mirrors {@link stripConsumedImageHandoffs} but targets the
 * user's ORIGINAL message instead of synthetic handoff messages.
 * The model has already "seen" the image and can reference it from
 * its prior turn context — the raw bytes are no longer needed.
 *
 * Mutates `messages` in place.
 *
 * @returns number of image_url parts removed
 */
export function stripConsumedUserImages(
  messages: OpenAIChatMessage[]
): number {
  let removed = 0;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "user") continue;
    // Skip synthetic handoff messages — those are handled by
    // stripConsumedImageHandoffs.
    if (isImageHandoffMessage(message)) continue;

    const content = message.content as OpenAIMessageContent | null;
    if (!Array.isArray(content)) continue;

    const imageParts = imageUrlParts(message);
    if (imageParts.length === 0) continue;

    // Only strip if a later assistant message exists — i.e. the model
    // has already responded to (and thus "seen") this user message.
    const consumedByLaterAssistant = messages
      .slice(i + 1)
      .some((later) => later.role === "assistant");
    if (!consumedByLaterAssistant) continue;

    // Keep only the text parts. If there are no text parts, create a
    // minimal placeholder so the user message is not empty.
    const textParts = content.filter(
      (part): part is OpenAITextContentPart =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text"
    );

    const replacementContent: OpenAITextContentPart[] =
      textParts.length > 0
        ? textParts
        : [
            {
              type: "text",
              text: `[${imageParts.length} image(s) previously attached — bytes released after the model processed them.]`,
            },
          ];

    messages[i] = {
      ...message,
      content: replacementContent,
    };
    removed += imageParts.length;
  }
  return removed;
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
    `${IMAGE_HANDOFF_MARKER}\n` +
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
