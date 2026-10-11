import { createHash } from "node:crypto";
import type { AiTaskOperationEntity } from "@/entity/AiTaskOperation.entity";
import type {
  AiTaskOperationState,
  TaskExecutionReasonCode,
} from "@/entityTypes/aiTaskExecutionTypes";

/**
 * TaskOperationGuard (technical-design §10; audit T23).
 *
 * Durability wrapper around a consequential tool dispatch (§10.2): fenced
 * claim → dispatch → receipt/unknown, with stable domain/target/intent
 * identity (§10.1) and a cross-execution unresolved-operations fence so a
 * new execution ID or conversation cannot bypass an earlier send whose
 * outcome was never observed.
 *
 * The guard does NOT replace native dedup/authorization — §10.1 says to
 * prefer native claims/receipts and retain existing send-batch
 * authorization checks (the loop's outbound gate already ran before this
 * point). It adds the missing durability: a persisted operation row per
 * execution+target that survives crashes, plus the §10.2 pre-dispatch
 * unresolved check across ALL executions.
 *
 * Operation-key contract: exactly `op:<executionId>:<targetId>` — the same
 * derivation `EvidenceProviderFactory.deriveOperationKey` uses, so
 * operation_receipt criteria resolve the rows this guard writes.
 *
 * §10.1 sensitive-data rule: credentials, volatile IDs, and raw sensitive
 * data (recipient addresses, email bodies) never enter the intent hash,
 * keys, or logs — the hash covers only the stable, approved intent shape.
 */

/** Stable operation-key derivation — MUST match EvidenceProviderFactory. */
export function guardOperationKey(executionId: string, targetId: string): string {
  return `op:${executionId}:${targetId}`;
}

/**
 * Canonical §10.1 intent hash. Covers ONLY the stable, approved intent
 * shape: trusted tool identity + approved domain target + the whitelisted
 * intent arguments listed in `intentFields`. Credentials, timestamps,
 * message ids, and any argument not listed are excluded — a volatile or
 * sensitive value must never change the identity of an operation.
 */
export function computeIntentHash(input: {
  readonly toolIdentity: string;
  readonly domainTarget: string;
  readonly intentArguments?: Readonly<Record<string, unknown>>;
  /** Explicit allowlist of stable argument names to include in the hash. */
  readonly intentFields?: readonly string[];
}): string {
  const parts: string[] = [`tool:${input.toolIdentity}`];
  parts.push(`target:${input.domainTarget}`);
  if (input.intentFields && input.intentFields.length > 0) {
    const args = input.intentArguments ?? {};
    for (const field of [...input.intentFields].sort()) {
      const value = args[field];
      if (value === undefined) continue;
      parts.push(`${field}:${canonicalValue(value)}`);
    }
  }
  return `sha256:${createHash("sha256").update(parts.join("|"), "utf8").digest("hex")}`;
}

function canonicalValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  // Deterministic JSON for objects/arrays; unknown shapes stringify as-is.
  return JSON.stringify(value, (_key, v: unknown) =>
    v instanceof Map ? Object.fromEntries(v) : v
  );
}

/** Why the guard refused a dispatch. */
export type OperationGuardBlockReasonCode =
  | "OPERATION_UNKNOWN_OUTCOME"
  | "OPERATION_ALREADY_CONFIRMED"
  | "OPERATION_UNRESOLVED_EARLIER";

export interface OperationGuardDescriptor {
  /** Trusted tool identity, e.g. `start_email_send_task`. */
  readonly toolIdentity: string;
  /**
   * Stable approved domain target, derived from TRUSTED context (e.g. the
   * outbound gate's authorization batchId) — never from raw model text.
   * Null for non-targeted operations.
   */
  readonly domainTarget: string | null;
  /** Whitelisted stable argument names folded into the intent hash. */
  readonly intentFields?: readonly string[];
  /** Full arguments (only the allowlisted fields are hashed). */
  readonly intentArguments?: Readonly<Record<string, unknown>>;
}

export interface OperationGuardDecision {
  readonly allowed: boolean;
  readonly reasonCode?: OperationGuardBlockReasonCode;
  /** Human-safe explanation for the tool result (no sensitive data). */
  readonly reason?: string;
  /** Present when allowed: the claim generation to pass to postDispatch. */
  readonly claimGeneration?: number;
  /** Present when allowed: the canonical intent hash for this dispatch. */
  readonly intentHash?: string;
  /**
   * Present when allowed: the occurrence ordinal (0 = stable identity,
   * ≥1 = retry of an evidenced no-effect failure). Thread back into
   * settleDispatch so both land on the same row.
   */
  readonly occurrenceOrdinal?: number;
  /** Present when a confirmed receipt was reused for this exact intent. */
  readonly reusedReceiptState?: AiTaskOperationState;
}

export interface OperationGuardDeps {
  /** Creates the operation row (idempotent per operation key). */
  readonly recordOperation: (input: {
    readonly operationKey: string;
    readonly executionId: string;
    readonly toolIdentity: string;
    readonly domainTarget: string | null;
    readonly intentHash: string;
  }) => Promise<{ ok: boolean; alreadyExists?: boolean; reasonCode?: TaskExecutionReasonCode }>;
  /** Reads one operation by key. */
  readonly getOperation: (
    operationKey: string
  ) => Promise<AiTaskOperationEntity | null>;
  /** §10.2 cross-execution unresolved lookup. */
  readonly findUnresolvedByIntent: (input: {
    readonly toolIdentity: string;
    readonly domainTarget: string | null;
    readonly intentHash: string;
    readonly limit?: number;
  }) => Promise<AiTaskOperationEntity[]>;
  /** CAS state transition. */
  readonly updateState: (input: {
    readonly operationKey: string;
    readonly expectedClaimGeneration: number;
    readonly newState: AiTaskOperationState;
  }) => Promise<{ ok: boolean; reasonCode?: TaskExecutionReasonCode }>;
  /** Set the native receipt reference (e.g. attempt id) on the row. */
  readonly setReceiptReference?: (input: {
    readonly operationKey: string;
    readonly expectedClaimGeneration: number;
    readonly receiptReference: string;
  }) => Promise<boolean>;
}

const TERMINAL_STATES: ReadonlySet<string> = new Set([
  "accepted",
  "completed",
  "failed",
]);

export class TaskOperationGuard {
  constructor(
    private readonly deps: OperationGuardDeps,
    private readonly executionId: string
  ) {}

  /**
   * §10.2 pre-dispatch fence. Order of checks:
   * 1. Cross-execution unresolved lookup FIRST — a new execution ID or
   *    conversation must not bypass an unknown earlier send/job for the
   *    same intent/target.
   * 2. This execution's own row: confirmed receipt → reuse; unknown/pending
   *    earlier occurrence → block blind replay.
   * 3. Create/claim the operation row and allow dispatch.
   */
  async prepareDispatch(
    descriptor: OperationGuardDescriptor
  ): Promise<OperationGuardDecision> {
    const intentHash = computeIntentHash({
      toolIdentity: descriptor.toolIdentity,
      domainTarget: descriptor.domainTarget ?? "none",
      intentArguments: descriptor.intentArguments,
      intentFields: descriptor.intentFields,
    });
    const domainTarget = descriptor.domainTarget;

    // 1. Cross-execution fence (§10.2): unresolved earlier operations for
    // the same tool+target OR the same intent hash, from ANY execution.
    const unresolved = await this.deps.findUnresolvedByIntent({
      toolIdentity: descriptor.toolIdentity,
      domainTarget,
      intentHash,
    });
    const foreignUnresolved = unresolved.find(
      (op) => op.execution_id !== this.executionId
    );
    if (foreignUnresolved) {
      return {
        allowed: false,
        reasonCode: "OPERATION_UNRESOLVED_EARLIER",
        reason:
          "An earlier operation with the same intent has an unresolved outcome. " +
          "Reconciliation is required before dispatching this intent again.",
      };
    }

    // 2. This execution's rows for the same intent. The receipt row keeps
    // the §10.1 stable identity (no ordinal) — retries of an evidenced
    // no-effect failure get a NEW occurrence row with an explicit ordinal,
    // never a mutated receipt. Occurrences are counted from the stable key.
    let occurrenceOrdinal = 0;
    const existingReceipt = domainTarget
      ? await this.deps.getOperation(
          guardOperationKey(this.executionId, domainTarget)
        )
      : null;
    if (existingReceipt) {
      if (existingReceipt.intent_hash !== intentHash) {
        // Same key, changed intent — §10.1: a changed target must not
        // reuse the operation (this is the maker-invented-ordinal evasion
        // the design forbids). Fail closed.
        return {
          allowed: false,
          reasonCode: "OPERATION_UNKNOWN_OUTCOME",
          reason:
            "The stored operation intent differs from this dispatch (changed target).",
        };
      }
      if (TERMINAL_STATES.has(existingReceipt.operation_state)) {
        if (
          existingReceipt.operation_state === "accepted" ||
          existingReceipt.operation_state === "completed"
        ) {
          return {
            allowed: false,
            reasonCode: "OPERATION_ALREADY_CONFIRMED",
            reason:
              "This operation was already confirmed by a prior receipt. " +
              "Reusing the stored receipt instead of dispatching again.",
            reusedReceiptState: existingReceipt.operation_state,
          };
        }
        // failed → evidenced no-effect; a new occurrence may claim. The
        // ordinal is derived from the store (count of prior occurrences for
        // this execution+intent), never invented by the maker.
        occurrenceOrdinal = await this.countPriorOccurrences(
          descriptor,
          intentHash
        );
      } else if (
        existingReceipt.operation_state === "unknown" ||
        existingReceipt.operation_state === "dispatched"
      ) {
        // Unknown action outcome blocks blind replay even in this execution.
        return {
          allowed: false,
          reasonCode: "OPERATION_UNKNOWN_OUTCOME",
          reason:
            "An earlier dispatch of this operation has an unknown outcome. " +
            "Reconciliation is required before dispatching again.",
        };
      }
      // pending/claimed: fall through — the idempotent create below reuses
      // this row and the claim proceeds from its CURRENT generation.
    }

    // The occurrence key: stable identity for ordinal 0, explicit -ordinal
    // suffix for retries of an evidenced no-effect failure (§10.1: the
    // ordinal exists only because the contract permits repeats — failed
    // receipts are that evidence — and it is derived from the store, not
    // invented by the maker).
    const ownKey = this.resolveOccurrenceKey(
      descriptor,
      intentHash,
      occurrenceOrdinal
    );

    // 3. Create (idempotent) + claim fence. Read the current generation
    // after create so an alreadyExists reuse starts from the stored row.
    const recordResult = await this.deps.recordOperation({
      operationKey: ownKey,
      executionId: this.executionId,
      toolIdentity: descriptor.toolIdentity,
      domainTarget,
      intentHash,
    });
    if (!recordResult.ok && !recordResult.alreadyExists) {
      // INTENT_CONFLICT or store failure: fail closed with the reason code.
      return {
        allowed: false,
        reasonCode: "OPERATION_UNKNOWN_OUTCOME",
        reason:
          "The operation could not be recorded for durable tracking. " +
          `Reason: ${recordResult.reasonCode ?? "RECORD_FAILED"}.`,
      };
    }
    const current = await this.deps.getOperation(ownKey);
    if (!current) {
      return {
        allowed: false,
        reasonCode: "OPERATION_UNKNOWN_OUTCOME",
        reason: "The operation record vanished between create and claim.",
      };
    }
    if (current.intent_hash !== intentHash) {
      return {
        allowed: false,
        reasonCode: "OPERATION_UNKNOWN_OUTCOME",
        reason:
          "The stored operation intent differs from this dispatch (changed target).",
      };
    }
    const claim = await this.deps.updateState({
      operationKey: ownKey,
      expectedClaimGeneration: current.claim_generation,
      newState: "claimed",
    });
    if (!claim.ok) {
      // Lost the claim race (a concurrent occurrence holds the claim) — the
      // caller must reconcile rather than double-dispatch.
      return {
        allowed: false,
        reasonCode: "OPERATION_UNKNOWN_OUTCOME",
        reason: "Another occurrence holds the claim for this operation.",
      };
    }
    return {
      allowed: true,
      claimGeneration: current.claim_generation + 1,
      intentHash,
      occurrenceOrdinal,
    };
  }

  /**
   * Count stored rows for this execution + intent (any state). Used to
   * derive the §10.1 occurrence ordinal for a legitimate retry from the
   * store itself — the maker cannot invent an ordinal to evade a claim.
   */
  private async countPriorOccurrences(
    descriptor: OperationGuardDescriptor,
    intentHash: string
  ): Promise<number> {
    const related = await this.deps.findUnresolvedByIntent({
      toolIdentity: descriptor.toolIdentity,
      domainTarget: descriptor.domainTarget,
      intentHash,
      limit: 500,
    });
    // unresolved only lists non-terminal rows; the ordinal must count the
    // terminal failed receipt too. The receipt row holds the stable key, so
    // any prior occurrence keys sort after it. The count of unresolved rows
    // for this execution + 1 receipt row is the ordinal base.
    const unresolvedCount = related.filter(
      (op) => op.execution_id === this.executionId
    ).length;
    return unresolvedCount + 1;
  }

  /**
   * The occurrence key: stable identity for ordinal 0, explicit -ordinal
   * suffix for retries of an evidenced no-effect failure (§10.1). Shared by
   * prepareDispatch and settleDispatch so both land on the same row.
   */
  private resolveOccurrenceKey(
    descriptor: OperationGuardDescriptor,
    intentHash: string,
    occurrenceOrdinal: number
  ): string {
    const stableTarget =
      descriptor.domainTarget ?? intentHash.slice(0, 24);
    return occurrenceOrdinal === 0
      ? guardOperationKey(this.executionId, stableTarget)
      : guardOperationKey(
          this.executionId,
          `${stableTarget}#occ${occurrenceOrdinal}`
        );
  }

  /**
   * §10.2 post-dispatch settlement. Call AFTER the dispatch attempt returns:
   * success → accepted; definitive no-effect failure → failed; lost
   * response/timeout after the dispatch left the process → unknown (never
   * terminal, reconcilable by native status lookup).
   */
  async settleDispatch(input: {
    readonly descriptor: OperationGuardDescriptor;
    readonly claimGeneration: number;
    readonly intentHash: string;
    /** The dispatch's outcome classification. */
    readonly outcome: "confirmed" | "no_effect" | "unknown";
    /** Native receipt reference (e.g. send attempt id) when available. */
    readonly receiptReference?: string;
    /** Safe failure code for no_effect (never raw error text). */
    readonly failureCode?: string;
    /**
     * The occurrence ordinal returned by prepareDispatch (0 for the stable
     * identity, ≥1 for retries of evidenced no-effect failures). The settle
     * must land on the SAME row prepareDispatch claimed.
     */
    readonly occurrenceOrdinal?: number;
  }): Promise<{ ok: boolean; reasonCode?: TaskExecutionReasonCode }> {
    const operationKey = this.resolveOccurrenceKey(
      input.descriptor,
      input.intentHash,
      input.occurrenceOrdinal ?? 0
    );
    if (input.receiptReference && this.deps.setReceiptReference) {
      await this.deps.setReceiptReference({
        operationKey,
        expectedClaimGeneration: input.claimGeneration,
        receiptReference: input.receiptReference,
      });
    }
    const newState: AiTaskOperationState =
      input.outcome === "confirmed"
        ? "accepted"
        : input.outcome === "no_effect"
          ? "failed"
          : "unknown";
    // §10.2 legal paths: the row may still be `claimed` (the §10.2
    // dispatched-stamp lives inside this settle, not a separate loop call).
    // confirmed/unknown mean the dispatch DID happen (a receipt arrived, or
    // the response was lost after it left the process) — claimed →
    // dispatched → outcome. no_effect may be a before-dispatch failure
    // (e.g. worker_start_failed) — claimed → failed directly.
    const current = await this.deps.getOperation(operationKey);
    if (current?.operation_state === "claimed" && newState !== "failed") {
      const stamped = await this.deps.updateState({
        operationKey,
        expectedClaimGeneration: input.claimGeneration,
        newState: "dispatched",
      });
      if (!stamped.ok) {
        return stamped;
      }
      return this.deps.updateState({
        operationKey,
        expectedClaimGeneration: input.claimGeneration + 1,
        newState,
      });
    }
    return this.deps.updateState({
      operationKey,
      expectedClaimGeneration: input.claimGeneration,
      newState,
    });
  }
}
