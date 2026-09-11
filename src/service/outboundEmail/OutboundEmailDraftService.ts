import { createHash } from "node:crypto";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import {
  OutboundEmailEnvelopeHasher,
  type BatchEnvelopeEntry,
  type BatchEnvelopeEntryV2,
} from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import type { EmailItem } from "@/entityTypes/emailmarketingType";
import {
  OUTBOUND_POLICY_VERSION,
  OUTBOUND_VALIDATION_VERSION,
} from "@/service/outboundEmail/outboundReliabilityVersions";
import {
  normalizeEmailServiceIds,
  resolveOutboundIdentity,
  type ResolvedOutboundIdentity,
} from "@/service/outboundEmail/resolveOutboundSender";

/** Batch statuses whose envelope is not yet authorized — safe to fill sender. */
const SENDER_FILLABLE_STATUSES = new Set([
  "drafting",
  "draft_ready",
  "preflight_failed",
  "awaiting_review",
]);

/**
 * Draft generation + personalization for the intent-aware outbound-email
 * pipeline (technical design §10). Resolves the recipient source into a stable
 * canonicalized, deduplicated list, creates one draft per recipient, and
 * inserts an immutable revision holding the frozen envelope. The batch hash is
 * recomputed and stored so authorization can bind to it (AD-005).
 *
 * The service is main-process only: it reads the trusted conversation /
 * source-user-message / intent-decision identifiers from caller-supplied input
 * (never from model args), checks the AI entitlement gate first, and delegates
 * persistence to {@link OutboundEmailDraftModel}.
 */

/** Per-recipient personalization evidence (§10.3). */
export interface PersonalizationEvidence {
  readonly field: string;
  readonly valueHash: string;
  readonly sourceType:
    | "recipient_record"
    | "knowledge_document"
    | "user_instruction";
  readonly sourceId: string;
  readonly confidence: number;
}

export interface GenerateBatchInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly intentDecisionId: number;
  readonly recipientSourceType: string;
  /** When the source is an existing search task/list, its identifier; else null. */
  readonly recipientSourceId?: number | null;
  readonly recipients: ReadonlyArray<EmailItem>;
  readonly serviceIds: ReadonlyArray<number>;
  readonly senderAddress: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly bodyHtml: string | null;
}

export interface GenerateBatchResult {
  readonly success: boolean;
  readonly code?: string;
  readonly batchId?: number;
  readonly draftCount?: number;
  readonly batchHash?: string;
}

/** Constructor options. `aiEnabledOverride` short-circuits the Token check for tests. */
export interface OutboundEmailDraftServiceOptions {
  readonly dbpath?: string;
  readonly aiEnabledOverride?: boolean;
}

const SOURCE_TYPE = "recipient_record";

export class OutboundEmailDraftService {
  private readonly draftModel: OutboundEmailDraftModel;
  private readonly dbpath: string;
  private readonly aiEnabledOverride?: boolean;

  constructor(
    options: OutboundEmailDraftServiceOptions | string = {},
    legacyOptions?: OutboundEmailDraftServiceOptions
  ) {
    // Accept either a dbpath string (production wiring passes a path) or an
    // options object (tests pass overrides). Tolerate either positional form.
    const opts: OutboundEmailDraftServiceOptions =
      typeof options === "string"
        ? { dbpath: options, ...legacyOptions }
        : options;
    this.aiEnabledOverride = opts.aiEnabledOverride;
    this.dbpath = opts.dbpath ?? "";
    this.draftModel = new OutboundEmailDraftModel(this.dbpath);
  }

  // -- AI entitlement gate ------------------------------------------------

  /**
   * AI-feature gate (CLAUDE.md "AI Feature IPC Handlers — MANDATORY RULE"):
   * draft generation is an AI function, so it must not run when the user's plan
   * has AI disabled. Failures reading the token store are treated as disabled.
   */
  isAiEnabled(): boolean {
    if (this.aiEnabledOverride !== undefined) {
      return this.aiEnabledOverride;
    }
    try {
      return new Token().getValue(USER_AI_ENABLED) === "true";
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[outbound-email-draft] Failed to read USER_AI_ENABLED; treating AI as disabled: ${message}`
      );
      return false;
    }
  }

  // -- Recipient materialization (pure) -----------------------------------

  /**
   * Canonicalize and deduplicate recipients (§10.2). Canonicalization is
   * trim + lowercase whole-address; the first occurrence wins so the caller's
   * title/source for that address is preserved. Pure — no DB access, safe to
   * call from tests directly.
   */
  materializeRecipients(recipients: ReadonlyArray<EmailItem>): EmailItem[] {
    const seen = new Set<string>();
    const materialized: EmailItem[] = [];
    for (const r of recipients) {
      const address = (r.address ?? "").trim();
      if (address.length === 0) {
        continue;
      }
      const normalized = address.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      materialized.push({
        ...r,
        address: normalized,
        title: r.title,
        source: r.source,
      });
    }
    return materialized;
  }

  // -- Batch generation ----------------------------------------------------

  /**
   * Materialize recipients, create the batch + one draft + one immutable
   * revision per recipient, recompute the batch hash, and persist it (§10.4).
   * Returns `ai_disabled` when the AI entitlement gate fails. Never trusts the
   * model for `conversationId`/`sourceUserMessageId`/`intentDecisionId` —
   * those come from trusted caller input (§10.1).
   */
  async generateBatch(input: GenerateBatchInput): Promise<GenerateBatchResult> {
    if (!this.isAiEnabled()) {
      return { success: false, code: "ai_disabled" };
    }

    const materialized = this.materializeRecipients(input.recipients);
    if (materialized.length === 0) {
      return { success: false, code: "batch_empty" };
    }

    await this.draftModel.ensureConnection();

    // AD-006: sender selection completes before hashing. An empty caller
    // value is resolved from the selected / first active SMTP service so
    // review can never present a blank From that preflight then blocks.
    const bound = await this.bindSender(input);
    if (!bound) {
      return { success: false, code: "sender_address_missing" };
    }
    const { emailServiceId, smtpUsername, senderAddress, replyToAddress } =
      bound;

    // §7.2 batch row.
    const batch = await this.draftModel.createBatch(
      Object.assign(new OutboundEmailDraftBatchEntity(), {
        conversationId: input.conversationId,
        sourceUserMessageId: input.sourceUserMessageId,
        intentDecisionId: input.intentDecisionId,
        status: "drafting",
        recipientSourceType: input.recipientSourceType,
        recipientSourceId: input.recipientSourceId ?? null,
        recipientCount: materialized.length,
        validRecipientCount: materialized.length,
        emailServiceIdsJson: JSON.stringify(
          input.serviceIds.length > 0 ? [...input.serviceIds] : [emailServiceId]
        ),
        policyVersion: OUTBOUND_POLICY_VERSION,
        validationVersion: OUTBOUND_VALIDATION_VERSION,
      })
    );

    const envelopes: BatchEnvelopeEntryV2[] = [];

    for (const r of materialized) {
      // §7.3 draft row.
      const draft = await this.draftModel.createDraft(
        Object.assign(new OutboundEmailDraftEntity(), {
          batchId: batch.id,
          recipientAddress: r.address,
          recipientDisplayName: r.title ?? null,
          recipientSourceRef: r.source ?? null,
          status: "draft",
          revisionNumber: 0,
        })
      );

      // §10.3 personalization evidence: record that each generated field came
      // from the recipient record, not invented facts.
      const evidence: PersonalizationEvidence[] = [
        {
          field: "recipientAddress",
          valueHash: hashValue(r.address),
          sourceType: SOURCE_TYPE,
          sourceId: r.source ?? "direct",
          confidence: 1,
        },
      ];

      // §6.2 canonical envelope v2 + envelope hash (§17.3 — new revisions
      // always use version 2: smtpUsername + replyToAddress are bound into
      // the hash so authorization covers the full effective identity).
      const envelope: BatchEnvelopeEntryV2 = {
        version: 2,
        draftId: draft.id,
        emailServiceId,
        smtpUsername,
        senderAddress,
        replyToAddress,
        recipientAddress: r.address,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
      };
      const contentHash = OutboundEmailEnvelopeHasher.hashEnvelopeV2(envelope);
      envelopes.push(envelope);

      // §10.4 immutable revision (appendRevision assigns revisionNumber and
      // advances the draft pointer in one transaction).
      await this.draftModel.appendRevision({
        draftId: draft.id,
        actor: "ai",
        emailServiceId,
        envelopeVersion: 2,
        smtpUsername,
        replyToAddress,
        senderAddress,
        recipientAddress: r.address,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        contentHash,
        personalizationEvidenceJson: JSON.stringify(evidence),
      });
    }

    // §11 batch hash over the full v2 envelope set.
    const batchHash = OutboundEmailEnvelopeHasher.hashBatchV2(envelopes);
    await this.draftModel.updateBatchHash(batch.id, batchHash);
    await this.draftModel.updateBatchStatus(batch.id, "draft_ready");

    return {
      success: true,
      batchId: batch.id,
      draftCount: materialized.length,
      batchHash,
    };
  }

  /**
   * Repair drafts whose frozen envelope sender was never bound (empty From in
   * the review dialog). Completes AD-006 sender selection, appends a new
   * revision, and recomputes the batch hash. No-op once the batch is
   * authorized or already has a sender. Safe to call from GET and APPROVE.
   */
  async fillMissingSenders(batchId: number): Promise<{
    changed: boolean;
    originalBatchHash: string | null;
    batchHash: string | null;
  }> {
    const batch = await this.draftModel.readBatch(batchId);
    if (!batch || !SENDER_FILLABLE_STATUSES.has(batch.status)) {
      return {
        changed: false,
        originalBatchHash: batch?.batchHash ?? null,
        batchHash: batch?.batchHash ?? null,
      };
    }

    const originalBatchHash = batch.batchHash;
    const batchServiceIds = parseServiceIdsJson(batch.emailServiceIdsJson);
    const drafts = await this.draftModel.listDraftsByBatch(batchId);
    let changed = false;

    // Single batched read of all current revisions (avoids an N+1 query per
    // draft), plus a per-service identity cache so drafts sharing a service
    // resolve it once.
    const currentRevisions = await this.draftModel.readCurrentRevisions(
      drafts.map((d) => d.id)
    );
    const identityCache = new Map<number, ResolvedOutboundIdentity | null>();
    for (const draft of drafts) {
      const revision = currentRevisions.get(draft.id);
      if (!revision) {
        continue;
      }
      if (revision.senderAddress && revision.senderAddress.trim().length > 0) {
        continue;
      }

      const cacheKey = revision.emailServiceId;
      let resolved = identityCache.get(cacheKey);
      if (resolved === undefined) {
        resolved = await resolveOutboundIdentity({
          dbpath: this.dbpath,
          preferredServiceId: revision.emailServiceId,
          serviceIds: batchServiceIds,
        });
        identityCache.set(cacheKey, resolved);
      }
      if (!resolved) {
        continue;
      }

      const envelope: BatchEnvelopeEntryV2 = {
        version: 2,
        draftId: draft.id,
        emailServiceId: resolved.emailServiceId,
        smtpUsername: resolved.smtpUsername,
        senderAddress: resolved.senderAddress,
        replyToAddress: resolved.replyToAddress,
        recipientAddress: revision.recipientAddress,
        subject: revision.subject,
        bodyText: revision.bodyText,
        bodyHtml: revision.bodyHtml,
      };
      const contentHash = OutboundEmailEnvelopeHasher.hashEnvelopeV2(envelope);
      await this.draftModel.appendRevision({
        draftId: draft.id,
        actor: "ai",
        emailServiceId: resolved.emailServiceId,
        envelopeVersion: 2,
        smtpUsername: resolved.smtpUsername,
        replyToAddress: resolved.replyToAddress,
        senderAddress: resolved.senderAddress,
        recipientAddress: revision.recipientAddress,
        subject: revision.subject,
        bodyText: revision.bodyText,
        bodyHtml: revision.bodyHtml,
        contentHash,
        personalizationEvidenceJson: revision.personalizationEvidenceJson,
        knowledgeSourcesJson: revision.knowledgeSourcesJson,
        generationMetadataJson: revision.generationMetadataJson,
      });
      changed = true;
    }

    if (!changed) {
      return {
        changed: false,
        originalBatchHash,
        batchHash: originalBatchHash,
      };
    }

    const batchHash = await this.recomputeBatchHash(batchId);
    return { changed: true, originalBatchHash, batchHash };
  }

  /**
   * Prefer an explicit caller-supplied sender (tests / already-resolved
   * tools). Otherwise resolve from the selected SMTP service. Fail closed
   * (return null → `sender_address_missing`) when the named service cannot
   * resolve an identity — do NOT fabricate an identity from the caller's
   * sender address, which would bind a wrong smtpUsername and surface as a
   * confusing sender_identity_changed failure at delivery time.
   */
  private async bindSender(
    input: GenerateBatchInput
  ): Promise<ResolvedOutboundIdentity | null> {
    const trimmed = (input.senderAddress ?? "").trim();
    const serviceIds = [...input.serviceIds];
    if (trimmed.length > 0) {
      const emailServiceId = serviceIds[0];
      if (typeof emailServiceId === "number" && emailServiceId > 0) {
        // Caller supplied a sender address; still resolve the full identity
        // (smtpUsername + replyTo) for the service so the revision carries a
        // complete envelope snapshot (§6.4). Fail closed when the service
        // cannot resolve — the caller gets sender_address_missing.
        const identity = await resolveOutboundIdentity({
          dbpath: this.dbpath,
          preferredServiceId: emailServiceId,
          serviceIds,
        });
        if (identity) {
          // Use the caller's sender address but keep the resolved smtp/replyTo.
          return {
            emailServiceId: identity.emailServiceId,
            smtpUsername: identity.smtpUsername,
            senderAddress: trimmed,
            replyToAddress: identity.replyToAddress,
          };
        }
        return null;
      }
    }
    return await resolveOutboundIdentity({
      dbpath: this.dbpath,
      preferredServiceId: serviceIds[0] ?? null,
      serviceIds,
    });
  }

  async recomputeBatchHash(batchId: number): Promise<string | null> {
    const drafts = await this.draftModel.listDraftsByBatch(batchId);
    const v1Envelopes: BatchEnvelopeEntry[] = [];
    const v2Envelopes: BatchEnvelopeEntryV2[] = [];
    // Single batched read of all current revisions (avoids an N+1 query per
    // draft).
    const currentRevisions = await this.draftModel.readCurrentRevisions(
      drafts.map((d) => d.id)
    );
    for (const draft of drafts) {
      const revision = currentRevisions.get(draft.id);
      if (!revision) {
        continue;
      }
      const version = revision.envelopeVersion ?? 1;
      if (version === 2) {
        v2Envelopes.push({
          version: 2,
          draftId: draft.id,
          emailServiceId: revision.emailServiceId,
          smtpUsername: revision.smtpUsername ?? "",
          senderAddress: revision.senderAddress,
          replyToAddress: revision.replyToAddress,
          recipientAddress: revision.recipientAddress,
          subject: revision.subject,
          bodyText: revision.bodyText,
          bodyHtml: revision.bodyHtml,
        });
      } else {
        v1Envelopes.push({
          version: 1,
          draftId: draft.id,
          emailServiceId: revision.emailServiceId,
          senderAddress: revision.senderAddress,
          recipientAddress: revision.recipientAddress,
          subject: revision.subject,
          bodyText: revision.bodyText,
          bodyHtml: revision.bodyHtml,
        });
      }
    }
    if (v1Envelopes.length === 0 && v2Envelopes.length === 0) {
      return null;
    }
    // New revisions are always v2, but a batch may still contain legacy v1
    // revisions. Use the v2 batch hash when all envelopes are v2; v1 hash when
    // all are v1. Mixed batches hash as v2 (new revisions dominate the batch
    // state); the delivery service's §17.2 gate rejects mixed batches entirely.
    let batchHash: string;
    if (v2Envelopes.length > 0 && v1Envelopes.length === 0) {
      batchHash = OutboundEmailEnvelopeHasher.hashBatchV2(v2Envelopes);
    } else if (v1Envelopes.length > 0 && v2Envelopes.length === 0) {
      batchHash = OutboundEmailEnvelopeHasher.hashBatch(v1Envelopes);
    } else {
      // Mixed: hash v2 envelopes (new revisions dominate the batch state).
      batchHash = OutboundEmailEnvelopeHasher.hashBatchV2(v2Envelopes);
    }
    await this.draftModel.updateBatchHash(batchId, batchHash);
    return batchHash;
  }
}

function parseServiceIdsJson(json: string | null | undefined): number[] {
  if (!json) {
    return [];
  }
  try {
    return normalizeEmailServiceIds(JSON.parse(json) as unknown);
  } catch {
    return [];
  }
}

/** Stable short hash for evidence value provenance (not a security boundary). */
function hashValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}
