import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * IPC input schemas for the E2E-only seed channels (see
 * src/main-process/e2e/E2ESeedIpc.ts for why these exist and how they are
 * gated). These follow the same conventions as the other IPC schemas —
 * bare `zod` + lazySchema + strictObject — and are never registered outside
 * AIFETCHLY_E2E=1.
 */

// E2E_SEED_EMAIL_SERVICE — insert one email_service row with a plaintext
// password. Host/port shape mirrors EmailServiceEntity (varchar columns).
// The E2E spec points host at a loopback server that drops the connection
// mid-greeting, so the worker fails with an ambiguous SMTP error and the
// delivery deterministically ends in delivery_unknown (FR-019), exercising
// the real worker path without any external network.
//
// smtpUsername / replyTo are optional identity columns added in P0.3: the
// identity scenarios seed a service whose SMTP username differs from From
// (scenario 1) and/or a Reply-To independent of the From address. They are
// stored as-is (plaintext, like the password) because the E2E seed channel
// bypasses the production import-create encryption path — it writes the row
// directly through EmailServiceModel.create, so no secret-key fetch is
// needed for the seed itself.
export const e2eSeedEmailServiceInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1, "Service name is required").max(255),
    from: z.string().min(1, "Sender address is required").max(255),
    password: z.string().min(1, "Password is required").max(255),
    host: z.string().min(1, "SMTP host is required").max(255),
    port: z.string().min(1, "SMTP port is required").max(10),
    ssl: z.number().int().min(0).max(1).optional(),
    status: z.number().int().min(0).max(1).optional(),
    smtpUsername: z.string().max(255).optional(),
    replyTo: z.string().max(320).optional(),
    // G04 E2E: loopback IMAP receive config for the §7.1 probe. When
    // receiveEnabled is 1 with an imapHost/imapPort, the production
    // detector opens real (loopback) IMAP connections from the E2E app.
    // Username falls back to smtpUsername → from; password falls back to
    // the SMTP password (same production fallback chain, §8.3).
    receiveEnabled: z.number().int().min(0).max(1).optional(),
    imapHost: z.string().max(255).optional(),
    imapPort: z.string().max(10).optional(),
    imapSsl: z.number().int().min(0).max(1).optional(),
    receiveFolder: z.string().max(255).optional(),
  })
);

// E2E_SEED_RECEIVED_MESSAGE — insert one email_received_message row for the
// reply-evidence audit E2E flow (T10). The row goes through the production
// EmailReceivedMessageModel.upsertByProviderUid so the targeted-update /
// sticky-positive code paths stay exercised. `replyStatus` is a required
// seed field (not derived from `isAnswered`) because the E2E scenario needs
// to control the local-first detection outcome deterministically: "sent"
// makes the §7.1 step-1 local check short-circuit to `replied` without any
// mailbox round trip — no IMAP server is needed in the loopback-only E2E
// network. The seeded `messageId` is a full RFC header value so the audit
// detail recheck is realistic; the detection service re-normalizes it at
// runtime.
export const e2eSeedReceivedMessageInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: z.number().int().positive(),
    providerUid: z.string().min(1).max(255),
    messageId: z.string().min(1).max(998),
    fromAddress: z.string().min(1).max(320),
    toAddresses: z.array(z.string().min(1).max(320)).min(1),
    subject: z.string().min(1).max(998),
    replyStatus: z.enum([
      "not_started",
      "draft_created",
      "sent",
      "skipped",
      "blocked",
      "failed",
    ]),
    isAnswered: z.number().int().min(0).max(1).optional(),
    // G04 E2E: UID provenance for the §7.1 step-5 flag refresh. When set,
    // the seeded row looks like a synced IMAP message (namespaced
    // providerUid + source folder + UIDVALIDITY), so the production probe
    // completes the flag side against the loopback IMAP server instead of
    // treating the row as legacy/unresolved.
    providerFolder: z.string().max(255).optional(),
    providerUidValidity: z.string().max(64).optional(),
    // G03 E2E (local-provider generation): a deterministic classification
    // skips the model classifier so the generation JSON path is exercised
    // alone. Null/omitted keeps the legacy unclassified seed behavior.
    classification: z.string().min(1).max(50).optional(),
    classificationConfidence: z.number().min(0).max(1).optional(),
  })
);

// E2E_SEED_REPLY_DRAFT — materialize an approval-ready reply draft through the
// production Model/service layer: EmailReplyDraftModule.create →
// materializeRevision1 (immutable revision 1 + canonical content hash) →
// EmailReplyApprovalService.approveDraft (one-time token). This exists because
// the production EMAIL_REPLY_DRAFT_CREATE path requires a live AI provider
// round trip (the draft is produced by the model), while the E2E workflows need
// an already-materialized draft to drive the approval → send chain determinism.
// The approval token is returned ONCE in the seed result exactly as the
// production EMAIL_REPLY_DRAFT_APPROVE handler returns it; the test feeds it
// straight into EMAIL_REPLY_SEND.
//
// senderAddress/recipientAddress are required (the v1 envelope identity);
// seedFailedAttempt optionally seeds one definitely-failed send attempt
// (B08/R13 retry path) and flips the draft to status "failed".
//
// G02 E2E: requiresHumanReview optionally persists the model's review
// request (+ reasons/questions) on the seeded draft. When set, the seed
// SKIPS approveDraft (production approval would refuse the flagged draft —
// that refusal is itself asserted through the real APPROVE channel in-spec)
// and returns approvalId 0 with an empty token.
export const e2eSeedReplyDraftInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: z.number().int().positive(),
    messageId: z.number().int().positive(),
    subject: z.string().min(1).max(998),
    bodyText: z.string().min(1).max(20000),
    senderAddress: z.string().min(1).max(320),
    recipientAddress: z.string().min(1).max(320),
    seedFailedAttempt: z.boolean().optional(),
    requiresHumanReview: z.number().int().min(0).max(1).optional(),
    reviewReasonsJson: z.string().max(12000).optional(),
    unresolvedQuestionsJson: z.string().max(6000).optional(),
  })
);

// E2E_SEED_AUTO_REPLY_AUDIT — insert one email_auto_reply_audit_log row with
// the structured typed metadata (stage + code as proper JSON fields in
// `metadataJson`), exactly as the production refusal writers emit it. This
// drives the T10 audit-table evidence chip / audit-detail next-action chip
// E2E flow: the renderer extracts stage/code from the JSON at the IPC
// boundary (structured-data extraction, never English parsing) and renders
// the actionable states from the typed store.
export const e2eSeedAutoReplyAuditInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: z.number().int().positive(),
    messageId: z.number().int().positive(),
    draftId: z.number().int().positive().nullable().optional(),
    ruleId: z.number().int().positive().nullable().optional(),
    action: z.enum([
      "auto_reply_evaluated",
      "knowledge_library_searched",
      "draft_created",
      "approval_required",
      "auto_reply_sent",
      "auto_reply_blocked",
      "auto_reply_skipped",
      "auto_reply_failed",
    ]),
    decisionStatus: z.enum([
      "draft_created",
      "approval_required",
      "auto_sent",
      "blocked",
      "skipped",
      "failed",
      "needs_human_review",
    ]),
    classification: z
      .enum([
        "interested",
        "not_interested",
        "unsubscribe",
        "bounce",
        "auto_reply",
        "support_request",
        "needs_human_review",
        "unknown",
      ])
      .nullable()
      .optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    reason: z.string().max(2000).nullable().optional(),
    generatedSubject: z.string().max(998).nullable().optional(),
    generatedBodyPreview: z.string().max(2000).nullable().optional(),
    requiresUserApproval: z.number().int().min(0).max(1).optional(),
    errorMessage: z.string().max(2000).nullable().optional(),
    metadataJson: z.string().max(8000).nullable().optional(),
  })
);
