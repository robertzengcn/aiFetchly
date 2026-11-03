/**
 * Shared types for the email organization feature (forward / trash / restore).
 *
 * Implements the PRD `ai-email-forward-trash-organization-prd.md` Stage B.
 * These types are the single vocabulary shared by entities, models, services,
 * AI tools, IPC handlers and the renderer. Keep DTOs free of credentials,
 * raw provider payloads and filesystem paths.
 */

/** Kind of durable organization operation. */
export type EmailOrganizationOperationKind = "forward" | "trash" | "restore";

/**
 * Aggregate operation status. Derived from item states; `needs_reconciliation`
 * takes precedence while any item outcome is unknown.
 */
export type EmailOrganizationOperationStatus =
  | "prepared"
  | "awaiting_approval"
  | "authorized"
  | "running"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled"
  | "needs_reconciliation";

/** Terminal aggregate statuses (no further work may be claimed). */
export const EMAIL_ORGANIZATION_TERMINAL_STATUSES: readonly EmailOrganizationOperationStatus[] =
  ["succeeded", "partially_succeeded", "failed", "cancelled"];

export function isTerminalOperationStatus(
  status: EmailOrganizationOperationStatus
): boolean {
  return EMAIL_ORGANIZATION_TERMINAL_STATUSES.includes(status);
}

/** Per-item (per-message) status within an operation. */
export type EmailOrganizationItemStatus =
  | "pending"
  | "claimed"
  | "succeeded"
  | "partially_succeeded"
  | "noop"
  | "failed"
  | "cancelled"
  | "outcome_unknown";

export function isTerminalItemStatus(
  status: EmailOrganizationItemStatus
): boolean {
  return (
    status === "succeeded" ||
    status === "partially_succeeded" ||
    status === "noop" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "outcome_unknown"
  );
}

/**
 * Eligibility state of a stored message location. Only `verified` locations
 * may authorize remote mutation (AC-21: legacy rows stay readable but never
 * eligible).
 */
export type EmailMessageLocationState =
  | "verified"
  | "legacy_unverified"
  | "stale"
  | "missing";

/** Protocol of the stored location. */
export type EmailOrganizationProtocol = "imap" | "pop3";

/** Where an authorization came from. Content is never an origin. */
export type EmailOrganizationOrigin =
  | "direct_request"
  | "ui_review"
  | "ui_action"
  | "tool_confirmation";

/** Draft lifecycle. `ready` means a validated, reviewable revision exists. */
export type EmailForwardDraftStatus = "draft" | "ready" | "submitted" | "discarded";

/** Sent-copy tracking, independent from SMTP submission (design §9.4). */
export type EmailSentCopyStatus =
  | "not_requested"
  | "pending"
  | "saved"
  | "failed"
  | "unknown";

/** Attempt lifecycle phases (mirrors the reply attempt machine). */
export type EmailOrganizationAttemptPhase =
  | "claimed"
  | "dispatched"
  | "resolved";

/** Stable reason codes surfaced to tools/UI; UI maps them to localized text. */
export type EmailOrganizationErrorCode =
  | "AI_DISABLED"
  | "ACTION_NOT_AUTHORIZED"
  | "APPROVAL_EXPIRED"
  | "REVISION_CHANGED"
  | "ACCOUNT_NOT_AVAILABLE"
  | "CAPABILITY_UNSUPPORTED"
  | "TRASH_NOT_CONFIGURED"
  | "LOCATION_STALE"
  | "UID_VALIDITY_CHANGED"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_FETCH_FAILED"
  | "ATTACHMENT_UNAVAILABLE"
  | "ATTACHMENT_TOO_LARGE"
  | "MIME_UNSUPPORTED"
  | "TOO_MANY_RECIPIENTS"
  | "TOO_MANY_ATTACHMENTS"
  | "VALIDATION_FAILED"
  | "AUTHENTICATION_FAILED"
  | "NETWORK_BEFORE_DISPATCH"
  | "PROVIDER_REJECTED"
  | "OUTCOME_UNKNOWN"
  | "PARTIAL_RECIPIENT_ACCEPTANCE"
  | "LOCAL_COMMIT_PENDING"
  | "OPERATION_NOT_FOUND"
  | "OPERATION_NOT_CANCELLABLE"
  | "DESTINATION_INVALID"
  | "ALREADY_IN_TRASH";

/** Tool-contract action status (design §7 example result contract). */
export type EmailActionStatus =
  | "awaiting_approval"
  | "running"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled"
  | "needs_reconciliation";

/** Result envelope returned by mutating organization tools/IPC. */
export interface EmailActionResult {
  readonly success: boolean;
  readonly operationId: string;
  readonly status: EmailActionStatus;
  readonly completed: number;
  readonly failed: number;
  readonly unresolved: number;
  readonly pending: number;
  readonly cancelled: number;
  readonly errorCode?: string;
  readonly retryable: boolean;
}

/** Account capability report (design §5.1) with independent booleans. */
export interface EmailOrganizationCapabilityDto {
  readonly emailServiceId: number;
  readonly protocol: EmailOrganizationProtocol;
  readonly canFetchFullSource: boolean;
  readonly canSendForward: boolean;
  readonly canMoveToTrash: boolean;
  readonly canRestore: boolean;
  readonly trashFolderPath: string | null;
  readonly reasonCodes: readonly string[];
  readonly resolvedAt: string;
}

/** Folder entry reported by folder discovery. */
export interface EmailOrganizationFolderDto {
  readonly path: string;
  readonly name: string;
  readonly specialUse: string | null;
  readonly writable: boolean;
}

/** One attachment in a frozen forward manifest (no paths, no bytes). */
export interface EmailForwardAttachmentManifestEntry {
  /** Opaque part ID the model may reference when selecting attachments. */
  readonly partId: string;
  readonly displayName: string;
  readonly contentType: string | null;
  readonly decodedSize: number;
  readonly contentHash: string;
  readonly disposition: "attachment" | "inline";
  readonly contentId: string | null;
  readonly selected: boolean;
  /** Encrypted artifact reference; stripped from tool/UI projections. */
  readonly artifactId: string | null;
}

/** Per-recipient outcome for a forward submission. */
export interface EmailForwardRecipientOutcome {
  readonly address: string;
  /**
   * Envelope field provenance when known. Operation projections omit it:
   * item outcome rows flatten To/Cc/Bcc, so claiming "to" would be a lie.
   */
  readonly field?: "to" | "cc" | "bcc";
  readonly outcome: "accepted" | "rejected" | "unknown";
}

/** Safe item detail for tools/UI (no bodies, no raw provider strings). */
export interface EmailOrganizationItemDto {
  readonly itemId: number;
  readonly messageId: number;
  readonly status: EmailOrganizationItemStatus;
  readonly beforeFolderPath: string | null;
  readonly destinationFolderPath: string | null;
  readonly errorCode: string | null;
  readonly sanitizedError: string | null;
  readonly recipientOutcomes: readonly EmailForwardRecipientOutcome[];
}

/** Safe operation detail for tools/UI. */
export interface EmailOrganizationOperationDto {
  readonly operationId: string;
  readonly kind: EmailOrganizationOperationKind;
  readonly status: EmailOrganizationOperationStatus;
  readonly emailServiceId: number;
  readonly itemCounts: EmailOrganizationItemCountDto;
  readonly items: readonly EmailOrganizationItemDto[];
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly cancelRequestedAt: string | null;
  readonly errorCode: string | null;
  readonly retryable: boolean;
}

export interface EmailOrganizationItemCountDto {
  readonly completed: number;
  readonly failed: number;
  readonly unresolved: number;
  readonly pending: number;
  readonly cancelled: number;
}

/** Attachment selection mode for draft creation/update. */
export type EmailForwardAttachmentSelection =
  | { readonly mode: "all" }
  | { readonly mode: "none" }
  | { readonly mode: "parts"; readonly partIds: readonly string[] };

/** Review-mode decided by intent + request. */
export type EmailOrganizationIntentMode = "send_now" | "review_first" | "draft_only";

/** Pure intent decision (mirrors OutboundEmailIntentDecision shape). */
export interface EmailOrganizationIntentDecision {
  readonly mode: EmailOrganizationIntentMode;
  readonly reasonCode: string;
  readonly confidence: number;
  readonly resolverVersion: string;
}

/** Proposed product limits (PRD §8 / design §9.1). */
export const EMAIL_ORGANIZATION_LIMITS = {
  /** Raw source cap in bytes (30 MiB). */
  maxSourceBytes: 30 * 1024 * 1024,
  /** Total decoded attachment bytes (15 MiB). */
  maxTotalAttachmentBytes: 15 * 1024 * 1024,
  /** Maximum attachments per forward. */
  maxAttachments: 20,
  /** Maximum unique envelope recipients across To/Cc/Bcc. */
  maxRecipients: 20,
  /** Maximum MIME nesting depth tolerated while parsing. */
  maxMimeNesting: 20,
  /** Review/authorization expiry. */
  authorizationTtlMs: 15 * 60 * 1000,
  /** Attempt lease duration before reconciliation. */
  attemptLeaseMs: 10 * 60 * 1000,
  /** Unapproved artifact expiry. */
  unapprovedArtifactTtlMs: 24 * 60 * 60 * 1000,
  /** Capability cache TTL. */
  capabilityCacheTtlMs: 5 * 60 * 1000,
} as const;

/** Attachment part IDs are opaque, generated, and validated against this. */
export function isValidAttachmentPartId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}
