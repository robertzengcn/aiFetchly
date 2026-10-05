import { OutboundEmailAuthorizationModel } from "@/model/OutboundEmailAuthorization.model";
import { OutboundEmailIntentModel } from "@/model/OutboundEmailIntent.model";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailAuthorizationEntity } from "@/entity/OutboundEmailAuthorization.entity";
import {
  generateApprovalToken,
  hashApprovalToken,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import type { OutboundEmailAuthorizationType } from "@/entityTypes/outboundEmailDeliveryTypes";
import { OUTBOUND_RESOLVER_VERSION } from "@/service/outboundEmail/outboundReliabilityVersions";

/**
 * Trusted authorization for the outbound-email pipeline (technical design §13).
 * Application code — never the model — decides when an outbound send is
 * authorized (AD-003). Direct-send authorization is created automatically when
 * §13.1 conditions hold; review approval generates a one-time token whose raw
 * value is returned once and whose SHA-256 hash is the only thing persisted.
 */

const DIRECT_TTL_MS = 15 * 60 * 1000;
const REVIEW_TTL_MS = 30 * 60 * 1000;
const SUPPORTED_RESOLVER_VERSIONS: ReadonlySet<string> = new Set([
  "outbound-resolver-v1",
  OUTBOUND_RESOLVER_VERSION,
]);

export interface DirectSendAuthorizationInput {
  readonly intentDecisionId: number;
  readonly batchId: number;
  readonly sourceUserMessageId: string;
  readonly conversationId: string;
  readonly batchHash: string;
  /**
   * When true, a `draft_only` intent may still receive a direct-send
   * authorization. Used for `skip_review: true` on start_email_send_task
   * after phrase matching missed a user waiver. review_first still fails.
   */
  readonly allowDraftOnlyIntent?: boolean;
}

export interface DirectSendAuthorizationResult {
  readonly success: boolean;
  readonly code?:
    | "intent_not_send_now"
    | "source_message_mismatch"
    | "conversation_mismatch"
    | "batch_hash_mismatch"
    | "resolver_version_unsupported"
    | "authorization_already_active"
    | "batch_not_found"
    | "intent_not_found";
  readonly authorizationId?: number;
  readonly type?: OutboundEmailAuthorizationType;
}

export interface ResolveDirectSendForTurnInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly intentDecisionId: number;
  /**
   * When true, if this turn has no authorizable batch, inherit the latest
   * authorizable batch in the conversation. Used for chat confirmation
   * (`contextual_affirmation`) and skip-review follow-ups ("send it
   * directly without review") of a previously presented draft.
   */
  readonly inheritConversationDraft?: boolean;
  /**
   * When true, authorize a `draft_only` intent (model skip_review fallback).
   */
  readonly allowDraftOnlyIntent?: boolean;
}

export interface LookupTurnAuthorizationInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
}

/**
 * Existing-authorization lookup for the outbound-email tool gate. Unlike
 * {@link OutboundEmailAuthorizationService.resolveDirectSendForTurn}, this
 * never creates an `explicit_user_instruction` authorization. A draft without
 * a user Review approval must stay blocked as `review_required`.
 */
export interface LookedUpTurnAuthorization {
  readonly batchId: number | null;
  readonly authorization: ResolvedDirectSend | null;
}

/**
 * The authorization triple the outbound-email tool gate (§14.2) and the
 * delivery claim transaction (§15.1) both need. The gate checks that a
 * non-null triple exists for a send_now intent before the send tool runs;
 * the claim transaction uses `{batchId, authorizationId, batchHash}` as its
 * idempotency key. This is what `resolveDirectSendForTurn` returns.
 */
export interface ResolvedDirectSend {
  readonly batchId: number;
  readonly authorizationId: number;
  readonly batchHash: string;
}

export interface ReviewApprovalInput {
  readonly batchId: number;
  readonly batchHash: string;
  readonly sourceUserMessageId: string;
}

export interface ReviewApprovalResult {
  readonly success: boolean;
  readonly code?:
    | "batch_not_found"
    | "authorization_already_active"
    | "batch_hash_mismatch";
  readonly authorizationId?: number;
  /** Returned once; only the SHA-256 hash is persisted. */
  readonly token?: string;
  readonly batchHash?: string;
}

export interface OutboundEmailAuthorizationServiceOptions {
  readonly dbpath?: string;
}

export class OutboundEmailAuthorizationService {
  private readonly authorizationModel: OutboundEmailAuthorizationModel;
  private readonly intentModel: OutboundEmailIntentModel;
  private readonly draftModel: OutboundEmailDraftModel;

  constructor(options: OutboundEmailAuthorizationServiceOptions | string = {}) {
    const dbpath = typeof options === "string" ? options : options.dbpath ?? "";
    this.authorizationModel = new OutboundEmailAuthorizationModel(dbpath);
    this.intentModel = new OutboundEmailIntentModel(dbpath);
    this.draftModel = new OutboundEmailDraftModel(dbpath);
  }

  /**
   * Create an `explicit_user_instruction` authorization (§13.1). All conditions
   * must hold: intent mode is send_now; source message + conversation match the
   * intent; resolver version is supported; batch hash matches the persisted
   * batch; no active authorization already exists. Created by application code
   * automatically — no confirmation dialog, no global setting.
   */
  async createDirectSendAuthorization(
    input: DirectSendAuthorizationInput
  ): Promise<DirectSendAuthorizationResult> {
    const intent = await this.intentModel.read(input.intentDecisionId);
    if (!intent) {
      return { success: false, code: "intent_not_found" };
    }

    // §13.1 — intent mode must be send_now, unless this is the model
    // skip_review fallback for a phrase-matcher miss (draft_only only).
    if (intent.mode !== "send_now") {
      if (
        !(input.allowDraftOnlyIntent === true && intent.mode === "draft_only")
      ) {
        return { success: false, code: "intent_not_send_now" };
      }
    }

    // §13.1 — decision conversation and source message match the batch.
    if (intent.sourceUserMessageId !== input.sourceUserMessageId) {
      return { success: false, code: "source_message_mismatch" };
    }
    if (intent.conversationId !== input.conversationId) {
      return { success: false, code: "conversation_mismatch" };
    }

    // §13.1 — resolver version supported.
    if (!SUPPORTED_RESOLVER_VERSIONS.has(intent.resolverVersion)) {
      return { success: false, code: "resolver_version_unsupported" };
    }

    // §13.1 — batch exists and hash matches the persisted batch.
    const batch = await this.draftModel.readBatch(input.batchId);
    if (!batch) {
      return { success: false, code: "batch_not_found" };
    }
    if (batch.batchHash !== input.batchHash) {
      return { success: false, code: "batch_hash_mismatch" };
    }

    // §7.5 / §13.1 — only one active authorization per batch.
    const existing = await this.authorizationModel.findActiveByBatch(
      input.batchId
    );
    if (existing) {
      return { success: false, code: "authorization_already_active" };
    }

    const entity = Object.assign(new OutboundEmailAuthorizationEntity(), {
      batchId: input.batchId,
      type: "explicit_user_instruction" as const,
      sourceUserMessageId: input.sourceUserMessageId,
      intentDecisionId: input.intentDecisionId,
      batchHash: input.batchHash,
      tokenHash: null,
      status: "active" as const,
      expiresAt: new Date(Date.now() + DIRECT_TTL_MS),
    });
    const created = await this.authorizationModel.create(entity);

    // §8.1 batch lifecycle — a direct-send authorization moves the batch to
    // `direct_authorized` (the status the claim transaction requires).
    await this.draftModel.updateBatchStatus(
      input.batchId,
      "direct_authorized",
      {
        authorizationId: created.id,
        authorizedAt: new Date(),
      }
    );

    return {
      success: true,
      authorizationId: created.id,
      type: "explicit_user_instruction",
    };
  }

  /**
   * Look up an already-persisted authorization for this turn's latest
   * authorizable batch. Does not create one. The send-tool gate uses this so
   * a `send_now` intent cannot auto-send LLM-composed content before the
   * user clicks Review.
   */
  async lookupTurnAuthorization(
    input: LookupTurnAuthorizationInput
  ): Promise<LookedUpTurnAuthorization> {
    const batch = await this.draftModel.findLatestBatchForTurn(
      input.conversationId,
      input.sourceUserMessageId
    );
    if (!batch) {
      return { batchId: null, authorization: null };
    }

    const batchHash = batch.batchHash;
    if (!batchHash) {
      return { batchId: batch.id, authorization: null };
    }

    const existing = await this.authorizationModel.findActiveByBatch(batch.id);
    if (!existing) {
      return { batchId: batch.id, authorization: null };
    }

    return {
      batchId: batch.id,
      authorization: {
        batchId: batch.id,
        authorizationId: existing.id,
        batchHash,
      },
    };
  }

  /**
   * Orchestrate direct-send authorization for a turn (technical design §13.1 +
   * §14.2). Given the trusted turn identity and the persisted intent decision
   * id, it locates the turn's latest authorizable batch, creates (or reuses)
   * an `explicit_user_instruction` authorization, and returns the claim
   * triple. Ordinary send-tool gating must NOT call this — it would skip
   * Review. The query loop may call it for phrase-matched skip-review,
   * chat confirmation, or a boolean skip_review argument on the send tool
   * when the intent is not review_first / do-not-send / conflicting.
   *
   * Returns null when the turn has no authorizable batch or the intent is not
   * send_now. A missing batch maps to `draft_required`, so preparation can
   * continue without asking the user to confirm an already-explicit send.
   *
   * Idempotent across retries: if an active authorization already exists for
   * the batch (the model re-called the send tool after the gate allowed),
   * reuse it rather than erroring. This is the safe path — one authorization
   * per batch (AD-009) is still honored because `findActiveByBatch` returns
   * the single active row.
   */
  async resolveDirectSendForTurn(
    input: ResolveDirectSendForTurnInput
  ): Promise<ResolvedDirectSend | null> {
    // Find every non-terminal batch for this turn. Per-recipient draft
    // calls create one batch each; skip-review send must bind a unique
    // batch per start_email_send_task instead of only the newest.
    let batches = await this.draftModel.findAuthorizableBatchesForTurn(
      input.conversationId,
      input.sourceUserMessageId
    );
    if (batches.length === 0 && input.inheritConversationDraft) {
      const inherited =
        await this.draftModel.findLatestAuthorizableBatchForConversation(
          input.conversationId
        );
      if (inherited) {
        batches = [inherited];
      }
    }
    if (batches.length === 0) {
      return null;
    }

    for (const batch of batches) {
      const batchHash = batch.batchHash;
      if (!batchHash) {
        continue;
      }

      const existing = await this.authorizationModel.findActiveByBatch(
        batch.id
      );
      if (existing) {
        continue;
      }

      const created = await this.createDirectSendAuthorization({
        intentDecisionId: input.intentDecisionId,
        batchId: batch.id,
        sourceUserMessageId: input.sourceUserMessageId,
        conversationId: input.conversationId,
        batchHash,
        allowDraftOnlyIntent: input.allowDraftOnlyIntent,
      });
      if (created.success && created.authorizationId != null) {
        return {
          batchId: batch.id,
          authorizationId: created.authorizationId,
          batchHash,
        };
      }
    }

    // Every authorizable batch already has an active authorization (retry
    // of a single-batch turn). Reuse the newest so the claim stays
    // idempotent instead of erroring with authorization_already_active.
    for (let i = batches.length - 1; i >= 0; i--) {
      const batch = batches[i];
      if (!batch) {
        continue;
      }
      const batchHash = batch.batchHash;
      if (!batchHash) {
        continue;
      }
      const existing = await this.authorizationModel.findActiveByBatch(
        batch.id
      );
      if (existing) {
        return {
          batchId: batch.id,
          authorizationId: existing.id,
          batchHash,
        };
      }
    }

    return null;
  }

  /**
   * Create an `exact_draft_approval` authorization (§13.2). Generates a random
   * 256-bit token, stores only its SHA-256 hash, and returns the raw token once.
   * The raw token must not appear in model context, logs, audit metadata, URLs,
   * or renderer local storage.
   */
  async createReviewApproval(
    input: ReviewApprovalInput
  ): Promise<ReviewApprovalResult> {
    const batch = await this.draftModel.readBatch(input.batchId);
    if (!batch) {
      return { success: false, code: "batch_not_found" };
    }
    if (batch.batchHash !== input.batchHash) {
      return { success: false, code: "batch_hash_mismatch" };
    }

    const existing = await this.authorizationModel.findActiveByBatch(
      input.batchId
    );
    if (existing) {
      return { success: false, code: "authorization_already_active" };
    }

    const rawToken = generateApprovalToken();
    const tokenHash = hashApprovalToken(rawToken);

    const entity = Object.assign(new OutboundEmailAuthorizationEntity(), {
      batchId: input.batchId,
      type: "exact_draft_approval" as const,
      sourceUserMessageId: input.sourceUserMessageId,
      intentDecisionId: null,
      batchHash: input.batchHash,
      tokenHash,
      status: "active" as const,
      expiresAt: new Date(Date.now() + REVIEW_TTL_MS),
    });
    const created = await this.authorizationModel.create(entity);

    // §8.1 batch lifecycle — a review approval moves the batch to
    // `review_authorized` (the status the claim transaction requires).
    await this.draftModel.updateBatchStatus(
      input.batchId,
      "review_authorized",
      {
        authorizationId: created.id,
        authorizedAt: new Date(),
      }
    );

    return {
      success: true,
      authorizationId: created.id,
      token: rawToken,
      batchHash: input.batchHash,
    };
  }

  /**
   * Invalidate the active authorization for a batch (§13.3). Called when any
   * revision changes, a recipient changes, sender/service assignment changes,
   * or the batch is discarded.
   */
  async invalidateOnRevisionChange(
    batchId: number,
    reason: string
  ): Promise<void> {
    const active = await this.authorizationModel.findActiveByBatch(batchId);
    if (!active) {
      return;
    }
    await this.authorizationModel.invalidate(active.id, reason, new Date());

    // §8.1 batch lifecycle — invalidation returns the batch to `draft_ready`
    // so a fresh authorization can be created after the content stabilizes.
    await this.draftModel.updateBatchStatus(batchId, "draft_ready", {
      authorizationId: null,
      authorizedAt: null,
    });
  }

  /** Read an authorization by id. */
  async read(id: number): Promise<OutboundEmailAuthorizationEntity | null> {
    return await this.authorizationModel.read(id);
  }

  /** The active authorization for a batch, if any. */
  async findActiveByBatch(
    batchId: number
  ): Promise<OutboundEmailAuthorizationEntity | null> {
    return await this.authorizationModel.findActiveByBatch(batchId);
  }
}
