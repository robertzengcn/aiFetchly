/**
 * Type definitions for the `attach_local_images` built-in tool.
 *
 * This tool lets the chat model attach one to three local workspace images to
 * the active AI request. The central invariant is that prepared image bytes
 * travel through a TRANSIENT `modelArtifacts` channel that is deliberately
 * excluded from persisted tool results, hooks, renderer events, and logs.
 *
 * See:
 *   - docs/prd/ai-chat-llm-image-attachment-tool-prd.md
 *   - docs/prd/ai-chat-llm-image-attachment-tool-technical-design.md
 *
 * Pure types and constants only — no runtime or filesystem dependencies — so
 * this module can be imported by both the main process and (for the shared
 * limit constants) the renderer bundle.
 */

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

/**
 * Image MIME types accepted as TOOL INPUT. Driven by detected file signature,
 * not by file extension.
 */
export type SupportedImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

/**
 * Image MIME types produced by the normalizer for the outbound AI request.
 * The first release emits PNG (when alpha must be preserved and it fits) or
 * JPEG. WebP/GIF input is normalized to JPEG.
 */
export type PreparedImageMimeType = "image/png" | "image/jpeg";

/** OpenAI vision `detail` values forwarded to the AI server. */
export type ImageDetail = "auto" | "low" | "high";

// ---------------------------------------------------------------------------
// Transient model artifacts (NOT persisted)
// ---------------------------------------------------------------------------

/**
 * A single prepared image destined for the next AI request round.
 *
 * `dataUrl` is the ONLY field that carries image bytes. It MUST NOT be
 * persisted, logged, emitted to the renderer, or included in hook output.
 * Consumers should treat the whole object as transient.
 */
export interface ImageModelArtifact {
  readonly kind: "image";
  /** Base name only (no directory), for display and audit. */
  readonly fileName: string;
  /** Workspace-relative path using forward slashes, for display/audit. */
  readonly relativePath: string;
  /** Prepared (output) MIME type — `image/png` or `image/jpeg`. */
  readonly mimeType: PreparedImageMimeType;
  /** Size of the prepared (encoded) bytes, in bytes. */
  readonly sizeBytes: number;
  /** Prepared pixel width. */
  readonly width: number;
  /** Prepared pixel height. */
  readonly height: number;
  /** SHA-256 hex digest of the prepared bytes. */
  readonly sha256: string;
  /** Vision detail level forwarded to the model. */
  readonly detail: ImageDetail;
  /** `data:<mime>;base64,<...>` — transient, never persisted. */
  readonly dataUrl: string;
}

/**
 * Extensible discriminated union of transient artifacts the query loop can
 * attach to the next model round. Currently only images; future kinds (audio,
 * etc.) can extend this union without changing the transport contract.
 */
export type ModelArtifact = ImageModelArtifact;

// ---------------------------------------------------------------------------
// Tool arguments (runtime-validated; originate from the model)
// ---------------------------------------------------------------------------

/** Parsed arguments for `attach_local_images`. */
export interface AttachLocalImagesArgs {
  /** One to three exact paths, relative to the workspace or absolute inside it. */
  readonly paths: readonly string[];
  /** Vision detail level. Defaults to `"auto"`. */
  readonly detail?: ImageDetail;
}

// ---------------------------------------------------------------------------
// Persistable metadata (safe to store / emit / log)
// ---------------------------------------------------------------------------

/**
 * Metadata for one attached image. Contains NO bytes, NO data URL, and NO
 * absolute path outside the display policy. Safe to persist and render.
 */
export interface AttachedImageMetadata {
  readonly file_name: string;
  readonly relative_path: string;
  readonly mime_type: PreparedImageMimeType;
  readonly prepared_size_bytes: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly detail: ImageDetail;
}

/**
 * Per-file failure detail for the persistable result. Identifies the affected
 * relative path without leaking unrelated filesystem details.
 */
export interface AttachLocalImagesFileError {
  readonly relative_path: string;
  readonly code: AttachLocalImagesErrorCode;
  readonly error: string;
}

/**
 * The persistable tool result. This is the ONLY object that may be persisted,
 * emitted to the renderer, passed to hooks, or logged. It MUST NOT contain
 * `dataUrl`, buffers, or original absolute paths.
 */
export interface AttachLocalImagesResult {
  readonly success: boolean;
  readonly attached_count: number;
  readonly attachments: readonly AttachedImageMetadata[];
  readonly summary: string;
  readonly code?: AttachLocalImagesErrorCode;
  readonly error?: string;
  /** Present only for partial/atomic failures that name specific files. */
  readonly file_errors?: readonly AttachLocalImagesFileError[];
}

/**
 * Stable, model-readable error codes. Mapped to localized UI text in the
 * renderer; never returned to the model as raw stack traces.
 */
export type AttachLocalImagesErrorCode =
  | "workspace_required"
  | "invalid_arguments"
  | "image_limit_reached"
  | "path_outside_workspace"
  | "path_not_found"
  | "path_is_directory"
  | "image_file_too_large"
  | "unsupported_image_type"
  | "image_signature_mismatch"
  | "image_dimensions_too_large"
  | "image_payload_too_large"
  | "image_processing_failed"
  | "permission_denied"
  | "cancelled";

// ---------------------------------------------------------------------------
// Permission preview (metadata-only, display only)
// ---------------------------------------------------------------------------

/**
 * Generic, metadata-only permission preview carried through the approval
 * request so the UI can describe a tool call beyond the generic prompt.
 *
 * `items` are UNVALIDATED requested values for display only. They are never
 * treated as proof of workspace containment — the tool re-validates after
 * approval.
 */
export interface PermissionPreview {
  readonly kind: "file_transfer";
  /** i18n key for the preview title. */
  readonly titleKey: string;
  /** i18n key for the transfer description. */
  readonly descriptionKey: string;
  /** Requested relative/absolute paths, for display only. */
  readonly items: readonly string[];
  /** Label of the configured AI server destination (no credentials). */
  readonly destinationLabel: string;
}
