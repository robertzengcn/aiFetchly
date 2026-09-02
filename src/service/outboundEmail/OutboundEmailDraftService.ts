import { createHash } from "node:crypto";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import {
  OutboundEmailEnvelopeHasher,
  type BatchEnvelopeEntry,
} from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import type { EmailItem } from "@/entityTypes/emailmarketingType";

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
  readonly sourceType: "recipient_record" | "knowledge_document" | "user_instruction";
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
    this.draftModel = new OutboundEmailDraftModel(opts.dbpath ?? "");
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
  materializeRecipients(
    recipients: ReadonlyArray<EmailItem>
  ): EmailItem[] {
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
  async generateBatch(
    input: GenerateBatchInput
  ): Promise<GenerateBatchResult> {
    if (!this.isAiEnabled()) {
      return { success: false, code: "ai_disabled" };
    }

    const materialized = this.materializeRecipients(input.recipients);
    if (materialized.length === 0) {
      return { success: false, code: "batch_empty" };
    }

    await this.draftModel.ensureConnection();

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
        emailServiceIdsJson: JSON.stringify([...input.serviceIds]),
      })
    );

    const envelopes: BatchEnvelopeEntry[] = [];

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

      // §6.2 canonical envelope + envelope hash.
      const envelope: BatchEnvelopeEntry = {
        version: 1,
        draftId: draft.id,
        emailServiceId: input.serviceIds[0],
        senderAddress: input.senderAddress,
        recipientAddress: r.address,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
      };
      const contentHash = OutboundEmailEnvelopeHasher.hashEnvelope(envelope);
      envelopes.push(envelope);

      // §10.4 immutable revision (appendRevision assigns revisionNumber and
      // advances the draft pointer in one transaction).
      await this.draftModel.appendRevision({
        draftId: draft.id,
        actor: "ai",
        emailServiceId: input.serviceIds[0],
        senderAddress: input.senderAddress,
        recipientAddress: r.address,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        contentHash,
        personalizationEvidenceJson: JSON.stringify(evidence),
      });
    }

    // §11 batch hash over the full envelope set.
    const batchHash = OutboundEmailEnvelopeHasher.hashBatch(envelopes);
    await this.draftModel.updateBatchHash(batch.id, batchHash);
    await this.draftModel.updateBatchStatus(batch.id, "draft_ready");

    return {
      success: true,
      batchId: batch.id,
      draftCount: materialized.length,
      batchHash,
    };
  }
}

/** Stable short hash for evidence value provenance (not a security boundary). */
function hashValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}