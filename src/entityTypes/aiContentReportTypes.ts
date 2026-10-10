/**
 * AI-Generated Content Reporting — shared data contract.
 *
 * Mirrors `docs/prd/ai-content-reporting-prd.md` §12 (Shared Data Contract).
 * Used by the desktop renderer, the main-process IPC handler, the service
 * layer, and (as the source of truth) the companion backend PRD.
 *
 * Enums are declared as `as const` tuples so the Zod schema in
 * `src/schemas/ipc/aiContentReport.ts` can reuse them and so callers get
 * narrowed union types for free.
 */

/** Concern categories the reporter can choose (PRD §12.1). */
export const AI_CONTENT_REPORT_CATEGORIES = [
  "hate_or_harassment",
  "sexual_content",
  "violence_or_self_harm",
  "child_safety",
  "illegal_or_dangerous",
  "privacy_or_personal_data",
  "misinformation_or_deception",
  "copyright_or_ownership",
  "other",
] as const;
export type AIContentReportCategory =
  (typeof AI_CONTENT_REPORT_CATEGORIES)[number];

/** The kind of AI output being reported (PRD §12.1). */
export const AI_CONTENT_TYPES = [
  "text",
  "image",
  "mixed",
  "plan",
  "artifact",
  "email_template",
  "keyword_set",
] as const;
export type AIContentType = (typeof AI_CONTENT_TYPES)[number];

/** The surface where the reported output was shown (PRD §12.1). */
export const AI_OUTPUT_SURFACES = [
  "chat_v2",
  "legacy_chat",
  "knowledge_chat",
  "ai_artifact",
  "email_template_editor",
  "keyword_generator",
  "automatic_email_reply",
  "other",
] as const;
export type AIOutputSurface = (typeof AI_OUTPUT_SURFACES)[number];

/** Re-encoded display preview of a generated image (PRD §12.2, FR-3.5). */
export interface AIContentReportImagePreview {
  mimeType: "image/jpeg" | "image/webp" | "image/png";
  dataBase64: string; // max 1 MiB decoded per image
  width: number;
  height: number;
  sha256?: string;
}

/** Bounded evidence snapshot of the selected AI output (PRD §12.2). */
export interface AIContentReportOutput {
  text?: string; // max 32,000 chars
  textTruncated?: boolean;
  imagePreviews?: AIContentReportImagePreview[]; // max 3
  evidenceUnavailable?: boolean;
}

/** Source metadata needed for triage (PRD §12.2, FR-3.8). */
export interface AIContentReportContext {
  conversationId?: string; // max 128
  messageId?: string; // max 128
  artifactId?: string; // max 128
  model?: string; // max 128
  generatedAt?: string; // RFC3339
  appVersion: string; // max 64
  platform: "win32" | "darwin" | "linux";
  locale: string; // BCP 47, max 32
  /** Stable install identifier (same one diagnostics uses). Optional on the
   * wire so older clients can omit it; the backend treats it as best-effort. */
  installId?: string;
}

/** Request payload from renderer to main (PRD §12.2). */
export interface CreateAIContentReportRequest {
  schemaVersion: 1;
  clientReportId: string; // UUID generated once when the dialog opens
  surface: AIOutputSurface;
  contentType: AIContentType;
  category: AIContentReportCategory;
  comment?: string; // max 2,000 chars
  output: AIContentReportOutput;
  context: AIContentReportContext;
}

/** Response from the backend after a successful submission (PRD §12.3). */
export interface CreateAIContentReportResponse {
  reportId: string; // air_<server-generated token>
  status: "submitted";
  receivedAt: string; // RFC3339
  duplicate: boolean; // true when clientReportId already existed
}

/**
 * Safe, localized error code surfaced to the UI. The renderer maps each code
 * to a translated string via `aiContentReport.errors.*` keys. Never carries
 * raw backend text, stack traces, or parser errors (PRD FR-5.3, §14.3).
 */
export type AIContentReportErrorCode =
  | "network"
  | "auth_failed"
  | "invalid_evidence"
  | "payload_too_large"
  | "rate_limited"
  | "service_disabled"
  | "server_error"
  | "unknown";

/** Error thrown by the service layer and caught by the dialog. */
export class AIContentReportError extends Error {
  readonly code: AIContentReportErrorCode;
  constructor(code: AIContentReportErrorCode, message: string) {
    super(message);
    this.name = "AIContentReportError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Conversation reporting (schema version 2) — design §6.
// These EXTEND the version-1 types; nothing above this line changes.
// ---------------------------------------------------------------------------

export const AI_CONVERSATION_REPORT_SCOPES = [
  "selected_ai_outputs",
  "selected_ai_outputs_with_related_user_context",
] as const;

export type AIConversationReportScope =
  (typeof AI_CONVERSATION_REPORT_SCOPES)[number];

export const AI_CONVERSATION_REPORT_SURFACES = [
  "chat_v2",
  "legacy_chat",
  "knowledge_chat",
] as const;

export type AIConversationReportSurface =
  (typeof AI_CONVERSATION_REPORT_SURFACES)[number];

export interface AIConversationReportItem {
  itemId: string;
  messageId: string;
  sequence: number;
  role: "assistant" | "user";
  contentType: AIContentType;
  text?: string;
  textTruncated?: boolean;
  imagePreviews?: AIContentReportImagePreview[];
  evidenceUnavailable?: boolean;
  generatedAt?: string;
  model?: string;
  consentSource?: "related_user_context_toggle";
}

export interface AIConversationReportContext {
  conversationId: string;
  selectedAIItemCount: number;
  includedUserItemCount: number;
  aggregateTextTruncated?: boolean;
  appVersion: string;
  platform: "win32" | "darwin" | "linux";
  locale: string;
  installId?: string;
}

export interface CreateAIConversationReportRequest {
  schemaVersion: 2;
  clientReportId: string;
  surface: AIConversationReportSurface;
  reportScope: AIConversationReportScope;
  category: AIContentReportCategory;
  comment?: string;
  items: AIConversationReportItem[];
  context: AIConversationReportContext;
}

export type CreateAnyAIContentReportRequest =
  | CreateAIContentReportRequest
  | CreateAIConversationReportRequest;

export interface AIContentReportCapabilities {
  acceptedSchemaVersions: readonly number[];
  conversationReporting: {
    enabled: boolean;
    maxAIItems: number;
    maxUserItems: number;
    maxTotalItems: number;
    maxItemTextChars: number;
    maxAggregateTextChars: number;
    maxImages: number;
  };
}
