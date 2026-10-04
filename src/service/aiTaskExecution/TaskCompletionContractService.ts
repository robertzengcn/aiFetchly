/**
 * Freezes a completion contract from the objective + approved sources
 * (technical-design §5.1, FR-19).
 *
 * The contract hash is computed over a canonical JSON form of the
 * objective, criteria, and approved source IDs — EXCLUDING volatile
 * execution/provider IDs — so an unchanged Continue contract remains
 * comparable (§5.1). Source references must point only at messages in
 * `approvedSourceMessageIds`; runtime nudges/retrieved instructions can
 * never authorize work (FR-18).
 *
 * A verified-mode contract with zero required criteria cannot pass vacuously
 * (FR-04); freeze throws. Best-effort with zero criteria is allowed and
 * remains unverified unless evidence establishes every required criterion.
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  TaskCompletionContract,
  TaskCriterion,
} from "@/entityTypes/aiTaskExecutionTypes";

export interface FreezeInput {
  readonly objective: string;
  readonly sourceUserMessageId: string;
  readonly approvedSourceMessageIds: readonly string[];
  readonly mode: "verified" | "best_effort";
  readonly criteria: readonly TaskCriterion[];
}

function canonicalJson(value: unknown): string {
  // Deterministic serialization: sort object keys recursively so the hash is
  // stable regardless of insertion order. Excludes volatile IDs by
  // construction (callers pass only objective/criteria/sources).
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export class TaskCompletionContractService {
  freeze(input: FreezeInput): TaskCompletionContract {
    // Validate source references (FR-18): every criterion's sourceRefs must
    // point at an approved source message. SourceUserMessageId must itself
    // be in the approved set.
    const approvedSet = new Set(input.approvedSourceMessageIds);
    if (!approvedSet.has(input.sourceUserMessageId)) {
      throw new Error(
        "sourceUserMessageId must be in approvedSourceMessageIds"
      );
    }
    for (const criterion of input.criteria) {
      for (const ref of criterion.sourceRefs) {
        if (!approvedSet.has(ref.messageId)) {
          throw new Error(
            `criterion ${criterion.id} references unapproved message ${ref.messageId}`
          );
        }
        if (ref.endOffset < ref.startOffset) {
          throw new Error(
            `criterion ${criterion.id} has invalid offset range`
          );
        }
      }
    }

    // FR-04: a verified-mode contract with zero required criteria cannot
    // pass vacuously. Block at freeze time.
    if (
      input.mode === "verified" &&
      input.criteria.filter((c) => c.required).length === 0
    ) {
      throw new Error(
        "verified contract requires at least one required criterion"
      );
    }

    const contractId = `contract-${randomUUID()}`;
    const contractHash = this.computeHash(input);
    return {
      schemaVersion: 1,
      contractId,
      contractHash,
      objective: input.objective,
      sourceUserMessageId: input.sourceUserMessageId,
      approvedSourceMessageIds: [...input.approvedSourceMessageIds],
      mode: input.mode,
      criteria: input.criteria.map((c) => ({ ...c })),
    };
  }

  /** Recompute the hash for an existing contract to verify integrity on load. */
  verifyHash(contract: TaskCompletionContract): boolean {
    const recomputed = this.computeHash({
      objective: contract.objective,
      sourceUserMessageId: contract.sourceUserMessageId,
      approvedSourceMessageIds: contract.approvedSourceMessageIds,
      mode: contract.mode,
      criteria: contract.criteria,
    });
    return recomputed === contract.contractHash;
  }

  private computeHash(input: FreezeInput): string {
    const payload = {
      objective: input.objective,
      mode: input.mode,
      sourceUserMessageId: input.sourceUserMessageId,
      approvedSourceMessageIds: [...input.approvedSourceMessageIds].sort(),
      criteria: input.criteria.map((c) => ({
        id: c.id,
        required: c.required,
        kind: c.kind,
        // Include only kind-specific fields via a stable canonical form.
        // The discriminated-union spread is canonicalized by sortKeys.
        ...(c as Record<string, unknown>),
      })),
    };
    const hash = createHash("sha256");
    hash.update(canonicalJson(payload));
    return `sha256:${hash.digest("hex")}`;
  }
}
