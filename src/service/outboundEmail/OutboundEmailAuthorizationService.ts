import { OutboundEmailAuthorizationModel } from "@/model/OutboundEmailAuthorization.model";
import { OutboundEmailIntentModel } from "@/model/OutboundEmailIntent.model";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailAuthorizationEntity } from "@/entity/OutboundEmailAuthorization.entity";
import {
  generateApprovalToken,
  hashApprovalToken,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import type {
  OutboundEmailAuthorizationType,
} from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * Trusted authorization for the outbound-email pipeline (technical design §13).
 * Application code — never the model — decides when an outbound send is
 * authorized (AD-003). Direct-send authorization is created automatically when
 * §13.1 conditions hold; review approval generates a one-time token whose raw
 * value is returned once and whose SHA-256 hash is the only thing persisted.
 */

const DIRECT_TTL_MS = 15 * 60 * 1000;
const REVIEW_TTL_MS = 30 * 60 * 1000;
const SUPPORTED_RESOLVER_VERSION = "outbound-resolver-v1";

export interface DirectSendAuthorizationInput {
  readonly intentDecisionId: number;
  readonly batchId: number;
  readonly sourceUserMessageId: string;
  readonly conversationId: string;
  readonly batchHash: string;
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

  constructor(
    options: OutboundEmailAuthorizationServiceOptions | string = {}
  ) {
    const dbpath =
      typeof options === "string" ? options : options.dbpath ?? "";
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

    // §13.1 — intent mode must be send_now.
    if (intent.mode !== "send_now") {
      return { success: false, code: "intent_not_send_now" };
    }

    // §13.1 — decision conversation and source message match the batch.
    if (intent.sourceUserMessageId !== input.sourceUserMessageId) {
      return { success: false, code: "source_message_mismatch" };
    }
    if (intent.conversationId !== input.conversationId) {
      return { success: false, code: "conversation_mismatch" };
    }

    // §13.1 — resolver version supported.
    if (intent.resolverVersion !== SUPPORTED_RESOLVER_VERSION) {
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

    return {
      success: true,
      authorizationId: created.id,
      type: "explicit_user_instruction",
    };
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
  }

  /** Read an authorization by id. */
  async read(
    id: number
  ): Promise<OutboundEmailAuthorizationEntity | null> {
    return await this.authorizationModel.read(id);
  }

  /** The active authorization for a batch, if any. */
  async findActiveByBatch(
    batchId: number
  ): Promise<OutboundEmailAuthorizationEntity | null> {
    return await this.authorizationModel.findActiveByBatch(batchId);
  }
}