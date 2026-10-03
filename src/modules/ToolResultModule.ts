import "reflect-metadata";
import * as crypto from "node:crypto";
import { BaseModule } from "@/modules/baseModule";
import { ToolResultModel, type ToolOutputIdentity } from "@/model/ToolResult.model";
import { AIToolOutputEntity } from "@/entity/AIToolOutput.entity";
import { AIToolOutputScopeEntity } from "@/entity/AIToolOutputScope.entity";
import { AIToolOutputReservationEntity } from "@/entity/AIToolOutputReservation.entity";
import { AIToolOutputGrantEntity } from "@/entity/AIToolOutputGrant.entity";
import { AIToolOutputRetrievalBudgetEntity } from "@/entity/AIToolOutputRetrievalBudget.entity";
import { TOOL_RESULT_CONFIG, TOOL_RESULT_POLICY_VERSION } from "@/config/toolResultConfig";
import { pathSegmentFor } from "@/service/toolResult/ToolResultPaths";
import type {
  ToolOutputFormat,
  ToolResultErrorCode,
  LegacyProjection,
  LegacyProjectionLookup,
} from "@/entityTypes/toolResultTypes";

/**
 * Business logic for preserved tool outputs (technical design §5).
 *
 * This Module owns the two things that must never be bypassed:
 *
 *  1. THE EPOCH FENCE. Every write and every read is checked against the
 *     conversation's current output epoch. A writer that finishes after the
 *     user cleared the conversation cannot publish, and a deleted artifact can
 *     never be retrieved again.
 *
 *  2. QUOTA ADMISSION. Captured bytes plus outstanding reservations are
 *     charged against conversation and profile quotas BEFORE bytes are
 *     written, and the system refuses new preservation rather than evicting
 *     committed referenced evidence.
 *
 * It also owns artifact identity, so the same execution deduplicates onto one
 * artifact (AC-25) and a same-identity/different-bytes conflict is reported
 * instead of overwriting committed evidence.
 */

/** Result of a quota admission check. */
export type QuotaAdmission =
  | { ok: true; reservationId: string; reservedBytes: number }
  | { ok: false; code: Extract<ToolResultErrorCode, "OUTPUT_QUOTA_EXCEEDED" | "OUTPUT_DISK_FULL">; reason: string };

/** Result of creating or reusing the scope row for a conversation. */
export interface ToolOutputScope {
  readonly profileId: string;
  readonly conversationId: string;
  readonly outputEpoch: string;
  readonly invalidated: boolean;
}

/** Fields required to claim a writing slot for one output stream. */
export interface ClaimOutputInput {
  readonly profileId: string;
  readonly conversationId: string;
  readonly outputEpoch: string;
  readonly executionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly turnId?: string;
  readonly ownerAgentId?: string;
  readonly streamKey: string;
  readonly format: ToolOutputFormat;
  readonly mediaType: string;
  readonly sourceCompleteness: string;
  readonly originalBytes?: number;
  /** Expected total bytes when known; otherwise grow the reservation. */
  readonly expectedBytes?: number;
}

/** Outcome of claiming a writing slot. */
export type ClaimOutputResult =
  | {
      readonly kind: "claimed";
      readonly outputId: string;
      readonly leaseFence: string;
      readonly reservationId: string;
      readonly revision: number;
    }
  | {
      /** Same identity + same bytes: idempotent replay, reuse the artifact. */
      readonly kind: "existing";
      readonly output: AIToolOutputEntity;
    }
  | {
      /** Same identity + different bytes: never overwrite committed evidence. */
      readonly kind: "conflict";
      readonly output: AIToolOutputEntity;
    }
  | { readonly kind: "rejected"; readonly code: ToolResultErrorCode; readonly reason: string };

/** Authorization outcome for a read/search access. */
export type AccessDecision =
  | { ok: true; output: AIToolOutputEntity }
  | { ok: false; code: ToolResultErrorCode };

/** Free bytes reported by the filesystem, or null when unavailable. */
export type FreeSpaceProbe = () => Promise<number | null>;

/** Injectable clock + randomness so tests are deterministic. */
export interface ToolResultEnvironment {
  readonly now?: () => Date;
  readonly freeSpaceBytes?: FreeSpaceProbe;
}

function newEpoch(): string {
  return crypto.randomBytes(16).toString("hex");
}

function newOutputId(): string {
  return `out_${crypto.randomBytes(16).toString("hex")}`;
}

function newReservationId(): string {
  return `res_${crypto.randomBytes(16).toString("hex")}`;
}

function newFence(): string {
  return crypto.randomBytes(12).toString("hex");
}

export class ToolResultModule extends BaseModule {
  private model: ToolResultModel;
  private readonly now: () => Date;
  private readonly freeSpaceBytes?: FreeSpaceProbe;

  constructor(dbpath?: string, env: ToolResultEnvironment = {}) {
    super();
    this.model = new ToolResultModel(dbpath ?? this.dbpath);
    this.now = env.now ?? (() => new Date());
    this.freeSpaceBytes = env.freeSpaceBytes;
  }

  protected onSqliteDbRebound(): void {
    this.model = new ToolResultModel(this.dbpath);
  }

  // ------------------------------------------------------------- scopes --

  /**
   * Resolve (creating if needed) the scope for a conversation.
   *
   * The epoch is generated ONCE per conversation incarnation. Clearing or
   * deleting rotates it, so recreating a conversation id starts a fresh
   * generation and can never resurrect artifacts from the previous one.
   */
  async ensureScope(
    profileId: string,
    conversationId: string
  ): Promise<ToolOutputScope> {
    const existing = await this.model.findScope(profileId, conversationId);
    if (existing) {
      return {
        profileId: existing.profileId,
        conversationId: existing.conversationId,
        outputEpoch: existing.outputEpoch,
        invalidated: existing.invalidated,
      };
    }
    const entity = new AIToolOutputScopeEntity();
    entity.profileId = profileId;
    entity.conversationId = conversationId;
    entity.outputEpoch = newEpoch();
    entity.invalidated = false;
    const saved = await this.model.saveScope(entity);
    return {
      profileId: saved.profileId,
      conversationId: saved.conversationId,
      outputEpoch: saved.outputEpoch,
      invalidated: saved.invalidated,
    };
  }

  /**
   * Invalidate the scope and rotate the epoch.
   *
   * Deletion is STRONGER than cancellation: after this returns, every late
   * commit is rejected and every read fails, whether or not the writer has
   * finished. Grants are revoked in the same operation so a parent agent
   * cannot keep reading a deleted child's output through an existing grant.
   */
  async invalidateScope(
    profileId: string,
    conversationId: string
  ): Promise<string | null> {
    const scope = await this.model.findScope(profileId, conversationId);
    if (!scope) return null;
    // Paginate: a single bounded page would leave outputs beyond the limit
    // committed (epoch rotated so reads block, but grants never revoked and
    // the recovery sweep never reclaims them — a quota/count leak). Walk in
    // keyset batches by id until a page returns fewer than the page size.
    const pageSize = 1000;
    let afterId: number | undefined;
    let outputs = await this.model.listOutputsForScope({
      profileId,
      conversationId,
      outputEpoch: scope.outputEpoch,
      limit: pageSize,
      afterId,
    });
    while (outputs.length > 0) {
      for (const output of outputs) {
        await this.model.transitionOutputState({
          outputId: output.outputId,
          expectedStates: ["committed", "unavailable", "failed", "writing", "staged"],
          nextState: "deleting",
        });
        await this.model.revokeGrantsForOutput(output.outputId);
      }
      if (outputs.length < pageSize) break;
      afterId = outputs[outputs.length - 1].id;
      outputs = await this.model.listOutputsForScope({
        profileId,
        conversationId,
        outputEpoch: scope.outputEpoch,
        limit: pageSize,
        afterId,
      });
    }
    scope.invalidated = true;
    // Rotate so a writer still holding the OLD epoch cannot publish.
    scope.outputEpoch = newEpoch();
    await this.model.saveScope(scope);
    return scope.outputEpoch;
  }

  // -------------------------------------------------------------- quota --

  /**
   * Admit a capture of `requestedBytes`.
   *
   * Charges committed bytes PLUS outstanding reservations, reserves in bounded
   * increments for unknown-length streams, and refuses rather than evicting
   * committed referenced output. Free-disk reserve is checked when the host
   * can report it; an actual write failure after a successful check is still
   * handled by the caller as OUTPUT_DISK_FULL.
   */
  async admitQuota(input: {
    profileId: string;
    conversationId: string;
    outputEpoch: string;
    executionId: string;
    requestedBytes: number;
  }): Promise<QuotaAdmission> {
    const config = TOOL_RESULT_CONFIG;
    if (input.requestedBytes > config.artifactMaxBytes) {
      return {
        ok: false,
        code: "OUTPUT_QUOTA_EXCEEDED",
        reason: `requested ${input.requestedBytes} exceeds per-artifact cap ${config.artifactMaxBytes}`,
      };
    }

    if (this.freeSpaceBytes) {
      const free = await this.freeSpaceBytes();
      if (free !== null && free < config.minimumFreeDiskBytes) {
        return {
          ok: false,
          code: "OUTPUT_DISK_FULL",
          reason: `free space ${free} is below the ${config.minimumFreeDiskBytes} reserve`,
        };
      }
    }

    const existing = await this.model.findReservationByExecution(input.executionId);
    const currentReserved = existing?.reservedBytes ?? 0;
    const target = Math.max(
      input.requestedBytes,
      currentReserved === 0 ? config.reservationIncrementBytes : currentReserved
    );

    const usage = await this.model.quotaUsage({
      profileId: input.profileId,
      conversationId: input.conversationId,
    });
    const additional = target - currentReserved;
    if (
      usage.conversationBytes + additional > config.conversationQuotaBytes ||
      usage.profileBytes + additional > config.profileQuotaBytes
    ) {
      return {
        ok: false,
        code: "OUTPUT_QUOTA_EXCEEDED",
        reason: `conversation ${usage.conversationBytes}+${additional} or profile ${usage.profileBytes}+${additional} exceeds quota`,
      };
    }

    const reservation = new AIToolOutputReservationEntity();
    if (existing) {
      reservation.id = existing.id;
      reservation.reservationId = existing.reservationId;
    } else {
      reservation.reservationId = newReservationId();
    }
    reservation.profileId = input.profileId;
    reservation.conversationId = input.conversationId;
    reservation.outputEpoch = input.outputEpoch;
    reservation.executionId = input.executionId;
    reservation.reservedBytes = target;
    reservation.usedBytes = existing?.usedBytes ?? 0;
    reservation.leaseFence = newFence();
    reservation.leaseExpiresAt = new Date(
      this.now().getTime() + 15 * 60 * 1000
    );
    reservation.reservationState = "held";
    await this.model.saveReservation(reservation);

    return {
      ok: true,
      reservationId: reservation.reservationId,
      reservedBytes: target,
    };
  }

  /** Release the unused part of a reservation after a write settles. */
  async settleReservation(
    reservationId: string,
    usedBytes: number
  ): Promise<void> {
    await this.model.releaseReservation(reservationId, usedBytes);
  }

  // ------------------------------------------------------ artifact claim --

  /**
   * Claim a writing slot for one output stream, or report why not.
   *
   * Idempotency (AC-25): the artifact identity is
   * `(profile, conversation, epoch, executionId, streamKey)`, so a duplicated
   * tool_result event finds the existing row. If the source hash matches, the
   * caller reuses it (`existing`). If the bytes DIFFER, that is a `conflict` —
   * committed evidence is never overwritten, because a duplicate delivery with
   * different bytes means something is genuinely wrong upstream.
   */
  async claimOutput(input: ClaimOutputInput): Promise<ClaimOutputResult> {
    const scope = await this.model.findScope(input.profileId, input.conversationId);
    if (!scope || scope.invalidated || scope.outputEpoch !== input.outputEpoch) {
      return {
        kind: "rejected",
        code: "OUTPUT_NOT_AVAILABLE",
        reason: "conversation scope is invalidated or the epoch rotated",
      };
    }

    const identity: ToolOutputIdentity = {
      profileId: input.profileId,
      conversationId: input.conversationId,
      outputEpoch: input.outputEpoch,
      executionId: input.executionId,
      streamKey: input.streamKey,
    };
    const existing = await this.model.findOutputByIdentity(identity);
    const expectedBytes = input.expectedBytes;
    if (existing) {
      // A CONFLICT requires proof on both sides: we can only conclude the
      // bytes differ when the caller told us the expected size AND it differs
      // from what was captured. When the expected size is unknown (a stream
      // that had not been measured before the claim), reusing the committed
      // artifact is the safe, idempotent choice - treating "unknown" as
      // "different" would make every re-delivery of an unmeasured stream look
      // like a conflict and downgrade a good receipt.
      if (expectedBytes === undefined || existing.capturedBytes === expectedBytes) {
        return { kind: "existing", output: existing };
      }
      return { kind: "conflict", output: existing };
    }

    const admission = await this.admitQuota({
      profileId: input.profileId,
      conversationId: input.conversationId,
      outputEpoch: input.outputEpoch,
      executionId: input.executionId,
      requestedBytes: expectedBytes ?? 0,
    });
    if (!admission.ok) {
      return { kind: "rejected", code: admission.code, reason: admission.reason };
    }

    const outputId = newOutputId();
    const output = new AIToolOutputEntity();
    output.outputId = outputId;
    // Recorded so the recovery sweep can recognise this directory as
    // registered instead of deleting a committed artifact as an orphan.
    output.storageDirName = pathSegmentFor(outputId);
    output.profileId = input.profileId;
    output.conversationId = input.conversationId;
    output.outputEpoch = input.outputEpoch;
    output.turnId = input.turnId;
    output.ownerAgentId = input.ownerAgentId;
    output.executionId = input.executionId;
    output.toolCallId = input.toolCallId;
    output.toolName = input.toolName;
    output.streamKey = input.streamKey;
    output.revision = 1;
    output.outputState = "writing";
    output.storageBackend = "file";
    output.outputFormat = input.format;
    output.mediaType = input.mediaType;
    output.capturedBytes = 0;
    output.originalBytes = input.originalBytes;
    output.sourceCompleteness = input.sourceCompleteness;
    output.preservation = "complete";
    output.policyVersion = TOOL_RESULT_POLICY_VERSION;
    output.leaseFence = newFence();
    output.leaseExpiresAt = new Date(this.now().getTime() + 15 * 60 * 1000);
    // The terminal receipt is not published until the file is committed, so a
    // crash between rename and receipt leaves a recoverable pending row rather
    // than an assertion that the result was saved.
    output.receiptPublication = "pending";
    const saved = await this.model.saveOutput(output);

    return {
      kind: "claimed",
      outputId: saved.outputId,
      leaseFence: saved.leaseFence ?? "",
      reservationId: admission.reservationId,
      revision: saved.revision,
    };
  }

  /**
   * Commit a written artifact. The expected epoch AND lease fence must still
   * match, so a writer whose lease expired (or whose conversation was cleared)
   * cannot publish late (AC-14).
   */
  async commitOutput(input: {
    outputId: string;
    leaseFence: string;
    storageKey: string;
    capturedBytes: number;
    originalBytes?: number;
    sha256: string;
    preservation: "complete" | "partial";
    sourceCompleteness: string;
    recordCount?: number;
    receiptJson: string;
  }): Promise<boolean> {
    const current = await this.model.findOutputById(input.outputId);
    if (!current) return false;
    if (current.leaseFence !== input.leaseFence) return false;
    const scope = await this.model.findScope(current.profileId, current.conversationId);
    if (!scope || scope.invalidated || scope.outputEpoch !== current.outputEpoch) {
      return false;
    }
    const applied = await this.model.transitionOutputState({
      outputId: input.outputId,
      expectedStates: ["writing", "staged"],
      nextState: "committed",
      patch: {
        storageKey: input.storageKey,
        capturedBytes: input.capturedBytes,
        originalBytes: input.originalBytes ?? current.originalBytes,
        sha256: input.sha256,
        preservation: input.preservation,
        sourceCompleteness: input.sourceCompleteness,
        recordCount: input.recordCount,
        receiptJson: input.receiptJson,
        receiptPublication: "pending",
      },
    });
    return applied;
  }

  /**
   * Mark the terminal receipt as published. Idempotent: a second call is a
   * no-op, so a retried delivery cannot double-publish.
   */
  async markReceiptPublished(outputId: string): Promise<boolean> {
    const current = await this.model.findOutputById(outputId);
    if (!current) return false;
    if (current.receiptPublication === "published") return false;
    const applied = await this.model.transitionOutputState({
      outputId,
      expectedStates: ["committed"],
      nextState: "committed",
      patch: { receiptPublication: "published" },
    });
    return applied;
  }

  /** Mark a capture failed; the reservation is released by the caller. */
  async markOutputFailed(
    outputId: string,
    failureCode: ToolResultErrorCode
  ): Promise<boolean> {
    return await this.model.transitionOutputState({
      outputId,
      expectedStates: ["writing", "staged"],
      nextState: "failed",
      patch: { failureCode },
    });
  }

  // -------------------------------------------------------------- access --

  /**
   * Authorize one read/search access.
   *
   * A valid output id is NOT authorization. Every access re-checks the live
   * epoch, the row state, and either direct ownership or an explicit durable
   * grant. Unauthorized and missing are reported with the SAME code
   * (`OUTPUT_NOT_AVAILABLE`) so a sibling agent cannot learn whether an id
   * exists (AC-11).
   */
  async authorizeAccess(input: {
    outputId: string;
    profileId: string;
    conversationId: string;
    agentId?: string;
  }): Promise<AccessDecision> {
    const output = await this.model.findOutputById(input.outputId);
    if (!output) return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
    if (output.profileId !== input.profileId) {
      return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
    }
    if (output.outputState !== "committed") {
      // A failed/unavailable/deleting artifact is indistinguishable from a
      // missing one for authorization purposes.
      return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
    }
    const scope = await this.model.findScope(
      input.profileId,
      output.conversationId
    );
    if (!scope || scope.invalidated || scope.outputEpoch !== output.outputEpoch) {
      return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
    }

    const ownsConversation = output.conversationId === input.conversationId;
    const ownsAgent = (output.ownerAgentId ?? "") === (input.agentId ?? "");
    if (ownsConversation && ownsAgent) return { ok: true, output };

    const grant = await this.model.findGrant({
      outputId: output.outputId,
      granteeConversationId: input.conversationId,
      granteeAgentId: input.agentId,
    });
    if (grant && !grant.revokedAt) {
      const grantScope = await this.model.findScope(
        input.profileId,
        input.conversationId
      );
      if (grantScope && !grantScope.invalidated && grantScope.outputEpoch === grant.granteeEpoch) {
        return { ok: true, output };
      }
    }
    return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
  }

  /**
   * Record a durable delegation grant created by a child agent's export.
   *
   * The GRANTOR is the owner agent, so this verifies they can actually read the
   * artifact before creating a grant. Without that check, any caller able to
   * reach this method could mint themselves access to an arbitrary output id,
   * and the grant branch in {@link authorizeAccess} trusts the row.
   *
   * The grantee's epoch is also re-resolved from live state rather than taken
   * on faith, so a stale epoch cannot be used to widen access.
   */
  async grantAccess(input: {
    outputId: string;
    ownerProfileId: string;
    ownerConversationId: string;
    /**
     * The owning agent. Required for an agent-owned artifact: ownership is
     * conversation AND agent, so omitting it would make an agent-owned output
     * un-grantable by its own owner.
     */
    ownerAgentId?: string;
    granteeConversationId: string;
    granteeAgentId?: string;
    grantReason: string;
  }): Promise<{ granted: boolean; code?: ToolResultErrorCode }> {
    const decision = await this.authorizeAccess({
      outputId: input.outputId,
      profileId: input.ownerProfileId,
      conversationId: input.ownerConversationId,
      agentId: input.ownerAgentId,
    });
    if (!decision.ok) return { granted: false, code: decision.code };

    const granteeScope = await this.model.findScope(
      input.ownerProfileId,
      input.granteeConversationId
    );
    if (!granteeScope || granteeScope.invalidated) {
      return { granted: false, code: "OUTPUT_NOT_AVAILABLE" };
    }
    const granteeEpoch = granteeScope.outputEpoch;

    const grant = new AIToolOutputGrantEntity();
    grant.outputId = input.outputId;
    grant.granteeConversationId = input.granteeConversationId;
    grant.granteeEpoch = granteeEpoch;
    grant.granteeAgentId = input.granteeAgentId ?? "";
    grant.grantReason = input.grantReason;
    await this.model.saveGrant(grant);
    return { granted: true };
  }

  // ---------------------------------------------- retrieval-work budget --

  /**
   * Reserve one retrieval call against the durable per-turn allowance.
   *
   * The allowance is persisted, so a permission pause or crash cannot reset it.
   * Reservation happens BEFORE the work so two concurrent calls cannot both
   * observe the last remaining unit and both spend it; repeated reads are
   * charged as work rather than being free.
   */
  async reserveRetrievalCall(input: {
    profileId: string;
    conversationId: string;
    outputEpoch: string;
    agentId: string;
    turnId: string;
  }): Promise<{ ok: true; row: AIToolOutputRetrievalBudgetEntity } | { ok: false }> {
    const config = TOOL_RESULT_CONFIG;
    const existing = await this.model.findRetrievalBudget(input);
    if (!existing) {
      const row = new AIToolOutputRetrievalBudgetEntity();
      row.profileId = input.profileId;
      row.conversationId = input.conversationId;
      row.outputEpoch = input.outputEpoch;
      row.agentId = input.agentId;
      row.turnId = input.turnId;
      row.reservedCalls = 1;
      row.version = 1;
      try {
        return { ok: true, row: await this.model.saveRetrievalBudget(row) };
      } catch {
        // A concurrent creator won the unique key; fall through to the
        // conditional update path below.
      }
      const raced = await this.model.findRetrievalBudget(input);
      if (!raced) return { ok: false };
      return await this.tryReserveExisting(raced, config.retrievalMaxCalls);
    }
    return await this.tryReserveExisting(existing, config.retrievalMaxCalls);
  }

  private async tryReserveExisting(
    row: AIToolOutputRetrievalBudgetEntity,
    maxCalls: number
  ): Promise<{ ok: true; row: AIToolOutputRetrievalBudgetEntity } | { ok: false }> {
    // BOTH ceilings gate admission. Checking only the call count would let a
    // turn spend up to maxCalls * readMaxTokens tokens - twice the documented
    // per-turn allowance - and the token cap would never be enforced at all.
    if (row.reservedCalls + row.settledCalls >= maxCalls) return { ok: false };
    if (row.settledTokens >= TOOL_RESULT_CONFIG.retrievalMaxTokensPerTurn) {
      return { ok: false };
    }
    const applied = await this.model.reserveRetrievalCalls({
      profileId: row.profileId,
      conversationId: row.conversationId,
      outputEpoch: row.outputEpoch,
      agentId: row.agentId,
      turnId: row.turnId,
      expectedVersion: row.version,
      additionalCalls: 1,
    });
    if (!applied) return { ok: false };
    row.reservedCalls += 1;
    row.version += 1;
    return { ok: true, row };
  }

  /** Settle actual returned tokens after a reserved call completes. */
  async settleRetrievalCall(input: {
    profileId: string;
    conversationId: string;
    outputEpoch: string;
    agentId: string;
    turnId: string;
    tokens: number;
  }): Promise<void> {
    const row = await this.model.findRetrievalBudget(input);
    if (!row) return;
    await this.model.settleRetrievalWork({
      ...input,
      calls: 1,
      tokens: input.tokens,
    });
  }

  /**
   * Remaining returned-token allowance for the current turn.
   *
   * Enforced inside {@link reserveRetrievalCall}; exposed for callers that need
   * to size a request up front.
   */
  async remainingRetrievalTokens(input: {
    profileId: string;
    conversationId: string;
    outputEpoch: string;
    agentId: string;
    turnId: string;
  }): Promise<number> {
    const row = await this.model.findRetrievalBudget(input);
    const used = row?.settledTokens ?? 0;
    return Math.max(0, TOOL_RESULT_CONFIG.retrievalMaxTokensPerTurn - used);
  }

  /**
   * Calls already spent or held by this turn, for diagnostics and tests.
   *
   * A reservation is NOT yet settled work, but it is spent: it was admitted
   * against the allowance and the call is running. `reservedCalls` is released
   * on settlement, so this sum never double-counts a completed call.
   */
  async retrievalUsage(input: {
    profileId: string;
    conversationId: string;
    outputEpoch: string;
    agentId: string;
    turnId: string;
  }): Promise<{ calls: number; tokens: number }> {
    const row = await this.model.findRetrievalBudget(input);
    return {
      calls: (row?.reservedCalls ?? 0) + (row?.settledCalls ?? 0),
      tokens: row?.settledTokens ?? 0,
    };
  }

  // ------------------------------------------------------------- helpers --

  /** Outputs still awaiting terminal receipt publication (recovery sweep). */
  async listPendingPublications(limit: number): Promise<AIToolOutputEntity[]> {
    return await this.model.listRecoverableOutputs(["committed"], limit);
  }

  /** Streams whose writing lease expired (crash residue). */
  async listAbandonedClaims(now: Date, limit: number): Promise<AIToolOutputEntity[]> {
    return await this.model.listRecoverableOutputs(["writing", "staged"], limit);
  }

  /** Resolve the current epoch, for callers that need it before execution. */
  async currentEpoch(
    profileId: string,
    conversationId: string
  ): Promise<string> {
    return (await this.ensureScope(profileId, conversationId)).outputEpoch;
  }

  /**
   * Bounded slice of a legacy `legacy_message` source row.
   *
   * Exposed through the Module so the retrieval service never touches a
   * repository directly: the Model/Module boundary holds for this backend too.
   */
  async readLegacySourceSlice(input: {
    sourceRowKey: string;
    offsetBytes: number;
    lengthBytes: number;
  }): Promise<{ buffer: Buffer; totalBytes: number } | null> {
    return await this.model.readLegacySourceSlice(input);
  }

  /**
   * Bounded existence check: does this conversation hold ANY committed
   * output?
   *
   * Backs the retrieval-tool availability check, which must keep existing
   * references readable when capture is turned off. Implemented as a LIMIT 1
   * count so answering it can never pull a receipt into memory.
   */
  async hasAnyCommittedOutput(
    profileId: string,
    conversationId: string
  ): Promise<boolean> {
    return await this.model.hasCommittedOutput(profileId, conversationId);
  }

  /**
   * Look up an artifact row by its generated directory segment, with NO
   * authorization check.
   *
   * This exists exclusively for the recovery sweep, which must answer "is this
   * directory registered?" before deciding whether it is orphaned. The argument
   * is the hashed DIRECTORY NAME, not an output id. It returns only whether a
   * row exists; it is never used to serve content.
   */
  async findRegisteredOutputDir(dirName: string): Promise<boolean> {
    return (await this.model.findOutputByStorageDirName(dirName)) !== null;
  }

  /**
   * Resolve a batch of legacy projections for the context assembler (T14 /
   * design §10.2). Delegates to the Model's batch lookup and adapts the
   * entity rows to the `LegacyProjection` interface the assembler consumes,
   * so the assembler depends on the interface, not the Model/Module.
   *
   * Uses the live `policyVersion` so a policy change produces a cache miss
   * and the backfill rebuilds the projection under the new policy.
   */
  async findLegacyProjections(input: {
    profileId: string;
    sourceRowKeys: readonly string[];
    outputEpoch?: string;
  }): Promise<ReadonlyMap<string, LegacyProjection>> {
    const entities = await this.model.findProjectionsForRows({
      profileId: input.profileId,
      sourceRowKeys: input.sourceRowKeys,
      policyVersion: TOOL_RESULT_POLICY_VERSION,
      ...(input.outputEpoch ? { outputEpoch: input.outputEpoch } : {}),
    });
    const out = new Map<string, LegacyProjection>();
    for (const e of entities.values()) {
      out.set(e.sourceRowKey, {
        sourceRowKey: e.sourceRowKey,
        content: e.content,
        metadataJson: e.metadataJson,
        outputRefsJson: e.outputRefsJson,
      });
    }
    return out;
  }

  /**
   * Return a `LegacyProjectionLookup` adapter bound to this Module, for
   * wiring into `AIChatContextAssembler` deps. The adapter is a thin closure
   * over {@link findLegacyProjections}; it is the only surface the assembler
   * sees, keeping the Module's other methods out of the assembler's reach.
   */
  asLegacyProjectionLookup(): LegacyProjectionLookup {
    const self = this;
    return {
      async lookup(input: {
        profileId: string;
        sourceRowKeys: readonly string[];
        outputEpoch?: string;
      }): Promise<ReadonlyMap<string, LegacyProjection>> {
        return self.findLegacyProjections(input);
      },
    };
  }
}
