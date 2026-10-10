import type {
  ChatV2GeneratedImageReference,
  ChatV2GeneratedImageReferenceMetadata,
} from "@/entityTypes/aiChatV2Types";
import type { ImageDetail } from "@/entityTypes/aiImageAttachmentToolTypes";

/**
 * Machine-readable error codes emitted when a generated-image edit request
 * fails validation or resolution. Sent to the renderer via
 * `ChatV2StreamChunk.errorCode` and mapped to localized messages.
 */
export type GeneratedImageReferenceErrorCode =
  | "generated_image_reference_invalid"
  | "generated_image_not_owned"
  | "generated_image_missing"
  | "generated_image_outside_store"
  | "generated_image_symlink_rejected"
  | "generated_image_unsupported_type"
  | "generated_image_too_large"
  | "generated_image_dimension_limit"
  | "generated_image_reference_limit"
  | "generated_image_ambiguous"
  | "generated_image_fusion_limit"
  | "generated_image_batch_partial"
  | "generated_image_batch_cancelled";

/** Error carrying a stable {@link GeneratedImageReferenceErrorCode}. */
export class GeneratedImageReferenceError extends Error {
  constructor(
    readonly code: GeneratedImageReferenceErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "GeneratedImageReferenceError";
  }
}

/** A fully authorized generated-image source resolved in the main process. */
export interface AuthorizedGeneratedImageSource {
  readonly reference: ChatV2GeneratedImageReference;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly protocolUrl: string;
  readonly fileName: string;
  /** Absolute on-disk path — main-process private, never sent to renderer. */
  readonly absolutePath: string;
}

/** One prepared image destined for the model as an edit input. Transient:
 * `dataUrl` must never be persisted or logged. */
export interface PreparedGeneratedImageArtifact {
  readonly reference: ChatV2GeneratedImageReference;
  readonly fileName: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly preparedSizeBytes: number;
  /** Base64 data URL — transient model-only payload. */
  readonly dataUrl: string;
  readonly detail: ImageDetail;
}

/** Renderer request to resolve generated images as edit inputs. */
export interface ResolveGeneratedImagesInput {
  readonly conversationId: string;
  readonly references: readonly ChatV2GeneratedImageReference[];
  readonly detail: ImageDetail;
  readonly signal?: AbortSignal;
}

/** Result of resolving generated images for one AI request round. */
export interface ResolveGeneratedImagesResult {
  readonly artifacts: readonly PreparedGeneratedImageArtifact[];
  readonly metadata: readonly ChatV2GeneratedImageReferenceMetadata[];
  readonly totalPreparedBytes: number;
  readonly totalDataUrlChars: number;
}

/** Strict identity parsed from a generated-image protocol URL. All path
 * parts are guaranteed sanitized and traversal-free. */
export interface GeneratedImageProtocolIdentity {
  readonly normalizedUser: string;
  readonly conversationPathPart: string;
  readonly messagePathPart: string;
  readonly fileName: string;
  /** Absolute candidate path under the user's generated-image store. */
  readonly candidatePath: string;
}
